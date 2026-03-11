const { createClient } = require('redis');

const RedisStoreModule = require('rate-limit-redis');

const defaultConfig = require('../../config');
const { RATE_LIMIT_STORE_MODES } = require('../../config/rateLimitStore');

const RedisStore = RedisStoreModule.default ?? RedisStoreModule;

const RATE_LIMIT_STORE_SCOPES = Object.freeze({
  API: 'api',
  STATUS: 'status',
});

const buildRedisStorePrefix = (rateLimitStoreConfig, scope) => {
  if (!Object.values(RATE_LIMIT_STORE_SCOPES).includes(scope)) {
    throw new Error(`Unknown rate-limit store scope: ${scope}`);
  }

  return `${rateLimitStoreConfig.redisPrefix}${scope}:`;
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
  logger?.info?.({ store: 'redis' }, 'Rate-limit store connected');

  let isClosed = false;

  return {
    close: async () => {
      if (isClosed || !redisClient.isOpen) {
        return;
      }

      isClosed = true;
      await redisClient.quit();
    },
    createStore: (scope) => new RedisStoreClass({
      prefix: buildRedisStorePrefix(rateLimitStoreConfig, scope),
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    kind: RATE_LIMIT_STORE_MODES.REDIS,
  };
};

module.exports = {
  buildRedisStorePrefix,
  createMemoryRateLimitStoreProvider,
  initializeRateLimitStoreProvider,
  RATE_LIMIT_STORE_SCOPES,
};
