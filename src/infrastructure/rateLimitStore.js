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

/**
 * @typedef {object} RateLimitStoreConfig
 * @property {string} kind
 * @property {string} [redisPrefix]
 * @property {string | undefined} [redisUrl]
 * @property {string} [redisTopology]
 */

/**
 * @typedef {object} RateLimitLogger
 * @property {(details: object, message?: string) => void} [warn]
 * @property {(details: object, message?: string) => void} [error]
 * @property {(details: object, message?: string) => void} [info]
 */

/**
 * @typedef {object} RateLimitStoreLike
 * @property {(key: string) => Promise<any>} increment
 * @property {(key: string) => Promise<void> | void} decrement
 * @property {(key: string) => Promise<void> | void} resetKey
 * @property {(options: any) => void} [init]
 * @property {(key: string) => Promise<any>} [get]
 * @property {() => Promise<void> | void} [resetAll]
 * @property {boolean} [localKeys]
 * @property {string} [prefix]
 */

/**
 * @typedef {object} RateLimitStoreProvider
 * @property {() => Promise<void>} close
 * @property {(scope: string) => RateLimitStoreLike | undefined} createStore
 * @property {string} kind
 */

/**
 * @param {RateLimitStoreConfig} rateLimitStoreConfig
 * @param {string} scope
 * @returns {string}
 */
const buildRedisStorePrefix = (rateLimitStoreConfig, scope) => {
  if (!(/** @type {string[]} */ (Object.values(RATE_LIMIT_STORE_SCOPES)).includes(scope))) {
    throw new Error(`Unknown rate-limit store scope: ${scope}`);
  }

  return `${rateLimitStoreConfig.redisPrefix}${scope}:`;
};

/**
 * @param {number} [windowMs]
 * @returns {{ resetTime: Date, totalHits: number }}
 */
const buildFailOpenRateLimitResponse = (windowMs) => ({
  resetTime: new Date(
    Date.now() + (Number.isFinite(windowMs) && /** @type {number} */ (windowMs) > 0
      ? /** @type {number} */ (windowMs)
      : FALLBACK_RATE_LIMIT_WINDOW_MS),
  ),
  totalHits: 1,
});

/**
 * @param {object} deps
 * @param {RateLimitLogger} [deps.logger]
 * @param {string} deps.scope
 * @param {RateLimitStoreLike} deps.store
 * @returns {RateLimitStoreLike}
 */
const createFailOpenStore = ({
  logger,
  scope,
  store,
}) => {
  /** @type {number | undefined} */
  let windowMs;

  /**
   * @param {string} operation
   * @param {unknown} error
   * @returns {void}
   */
  const logStoreError = (operation, error) => {
    logger?.warn?.({
      err: error,
      operation,
      scope,
      store: 'rate-limit',
    }, 'Rate-limit store operation failed; allowing request to proceed');
  };

  /** @type {RateLimitStoreLike} */
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
        return await /** @type {(key: string) => Promise<any>} */ (store.get)(key);
      } catch (error) {
        logStoreError('get', error);
        return undefined;
      }
    };
  }

  if (typeof store.resetAll === 'function') {
    failOpenStore.resetAll = async () => {
      try {
        await /** @type {() => Promise<void> | void} */ (store.resetAll)();
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

/**
 * @param {RateLimitStoreConfig} [rateLimitStoreConfig]
 * @returns {RateLimitStoreProvider}
 */
const createMemoryRateLimitStoreProvider = (
  rateLimitStoreConfig = defaultConfig.rateLimitStore,
) => ({
  close: async () => {},
  createStore: () => undefined,
  kind: rateLimitStoreConfig.kind ?? RATE_LIMIT_STORE_MODES.MEMORY,
});

/**
 * @typedef {object} RateLimitRedisClient
 * @property {(event: string, listener: (error: unknown) => void) => unknown} [on]
 * @property {() => Promise<unknown>} connect
 * @property {() => Promise<unknown>} quit
 * @property {boolean} isOpen
 * @property {(args: string[]) => Promise<unknown>} sendCommand
 */

/**
 * @typedef {new (storeOptions: {
 *   prefix: string,
 *   sendCommand: (...args: string[]) => Promise<any>,
 * }) => RateLimitStoreLike} RedisStoreCtor
 */

/**
 * @param {object} [options]
 * @param {{ rateLimitStore?: RateLimitStoreConfig }} [options.config]
 * @param {(clientOptions: { url?: string }) => RateLimitRedisClient} [options.createClientFn]
 * @param {RateLimitLogger} [options.logger]
 * @param {RedisStoreCtor} [options.RedisStoreClass]
 * @returns {Promise<RateLimitStoreProvider>}
 */
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
