const { createClient } = require('redis');

const RedisStoreModule = require('rate-limit-redis');

const defaultConfig = require('../../config');
const { RATE_LIMIT_STORE_MODES } = require('../../config/rateLimitStore');

const RedisStore = RedisStoreModule.default ?? RedisStoreModule;

const RATE_LIMIT_STORE_SCOPES = Object.freeze({
  API: 'api',
  STATUS: 'status',
});

const FALLBACK_RATE_LIMIT_WINDOW_MS = 1_000;

const buildRedisStorePrefix = (rateLimitStoreConfig, scope) => {
  if (!Object.values(RATE_LIMIT_STORE_SCOPES).includes(scope)) {
    throw new Error(`Unknown rate-limit store scope: ${scope}`);
  }

  return `${rateLimitStoreConfig.redisPrefix}${scope}:`;
};

const buildFailOpenRateLimitResponse = (windowMs) => ({
  resetTime: new Date(
    Date.now() + (Number.isFinite(windowMs) && windowMs > 0
      ? windowMs
      : FALLBACK_RATE_LIMIT_WINDOW_MS),
  ),
  totalHits: 1,
});

const createFailOpenStore = ({
  logger,
  scope,
  store,
}) => {
  let windowMs;

  const logStoreError = (operation, error) => {
    logger?.warn?.({
      err: error,
      operation,
      scope,
      store: 'rate-limit',
    }, 'Rate-limit store operation failed; allowing request to proceed');
  };

  const failOpenStore = {
    decrement: async (key) => {
      try {
        await store.decrement(key);
      } catch (error) {
        logStoreError('decrement', error);
      }
    },
    increment: async (key) => {
      try {
        return await store.increment(key);
      } catch (error) {
        logStoreError('increment', error);
        return buildFailOpenRateLimitResponse(windowMs);
      }
    },
    init: (options) => {
      windowMs = options?.windowMs;
      store.init?.(options);
    },
    resetKey: async (key) => {
      try {
        await store.resetKey(key);
      } catch (error) {
        logStoreError('resetKey', error);
      }
    },
  };

  if (typeof store.get === 'function') {
    failOpenStore.get = async (key) => {
      try {
        return await store.get(key);
      } catch (error) {
        logStoreError('get', error);
        return undefined;
      }
    };
  }

  if (typeof store.resetAll === 'function') {
    failOpenStore.resetAll = async () => {
      try {
        await store.resetAll();
      } catch (error) {
        logStoreError('resetAll', error);
      }
    };
  }

  if (typeof store.localKeys !== 'undefined') {
    failOpenStore.localKeys = store.localKeys;
  }

  if (typeof store.prefix !== 'undefined') {
    failOpenStore.prefix = store.prefix;
  }

  return failOpenStore;
};

const createMemoryRateLimitStoreProvider = (
  rateLimitStoreConfig = defaultConfig.rateLimitStore,
) => ({
  close: async () => {},
  createStore: () => undefined,
  kind: rateLimitStoreConfig.kind ?? RATE_LIMIT_STORE_MODES.MEMORY,
});

const initializeRateLimitStoreProvider = async ({
  config = defaultConfig,
  createClientFn = createClient,
  logger,
  RedisStoreClass = RedisStore,
} = {}) => {
  const rateLimitStoreConfig = config.rateLimitStore ?? defaultConfig.rateLimitStore;

  if (rateLimitStoreConfig.kind !== RATE_LIMIT_STORE_MODES.REDIS) {
    return createMemoryRateLimitStoreProvider(rateLimitStoreConfig);
  }

  if (!rateLimitStoreConfig.redisUrl) {
    throw new Error(
      'Rate-limit store is configured for Redis but no Redis URL was provided',
    );
  }

  const redisClient = createClientFn({
    url: rateLimitStoreConfig.redisUrl,
  });
  redisClient.on?.('error', (error) => {
    logger?.error?.({ err: error }, 'Rate-limit Redis client error');
  });
  await redisClient.connect();
  logger?.info?.({
    store: 'redis',
    topology: rateLimitStoreConfig.redisTopology,
  }, 'Rate-limit store connected');

  let isClosed = false;

  return {
    close: async () => {
      if (isClosed || !redisClient.isOpen) {
        return;
      }

      isClosed = true;
      await redisClient.quit();
    },
    createStore: (scope) => createFailOpenStore({
      logger,
      scope,
      store: new RedisStoreClass({
        prefix: buildRedisStorePrefix(rateLimitStoreConfig, scope),
        sendCommand: (...args) => redisClient.sendCommand(args),
      }),
    }),
    kind: RATE_LIMIT_STORE_MODES.REDIS,
  };
};

module.exports = {
  buildFailOpenRateLimitResponse,
  buildRedisStorePrefix,
  createMemoryRateLimitStoreProvider,
  createFailOpenStore,
  initializeRateLimitStoreProvider,
  RATE_LIMIT_STORE_SCOPES,
};
