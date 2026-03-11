const {
  buildRedisStorePrefix,
  createMemoryRateLimitStoreProvider,
  initializeRateLimitStoreProvider,
  RATE_LIMIT_STORE_SCOPES,
} = require('../../../src/infrastructure/rateLimitStore');

describe('rateLimitStore infrastructure', () => {
  it('builds prefixed Redis store namespaces per limiter scope', () => {
    expect(buildRedisStorePrefix({
      redisPrefix: 'alt-text-generator:rate-limit:',
    }, RATE_LIMIT_STORE_SCOPES.API)).toBe('alt-text-generator:rate-limit:api:');

    expect(buildRedisStorePrefix({
      redisPrefix: 'alt-text-generator:rate-limit:',
    }, RATE_LIMIT_STORE_SCOPES.STATUS)).toBe('alt-text-generator:rate-limit:status:');
  });

  it('returns a no-op provider for in-memory rate limiting', async () => {
    const provider = createMemoryRateLimitStoreProvider({ kind: 'memory' });

    expect(provider.kind).toBe('memory');
    expect(provider.createStore()).toBeUndefined();
    await expect(provider.close()).resolves.toBeUndefined();
  });

  it('connects Redis-backed providers, creates scoped stores, and closes the client', async () => {
    const redisClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      isOpen: true,
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
      sendCommand: jest.fn().mockResolvedValue('PONG'),
    };
    const createClientFn = jest.fn(() => redisClient);

    class FakeRedisStore {
      constructor(options) {
        this.options = options;
      }
    }

    const provider = await initializeRateLimitStoreProvider({
      config: {
        rateLimitStore: {
          kind: 'redis',
          mode: 'redis',
          redisPrefix: 'alt-text-generator:rate-limit:',
          redisUrl: 'redis://shared.example:6379',
        },
      },
      createClientFn,
      logger: {
        error: jest.fn(),
        info: jest.fn(),
      },
      RedisStoreClass: FakeRedisStore,
    });

    const apiStore = provider.createStore(RATE_LIMIT_STORE_SCOPES.API);
    const statusStore = provider.createStore(RATE_LIMIT_STORE_SCOPES.STATUS);

    expect(createClientFn).toHaveBeenCalledWith({
      url: 'redis://shared.example:6379',
    });
    expect(redisClient.connect).toHaveBeenCalledTimes(1);
    expect(apiStore.options.prefix).toBe('alt-text-generator:rate-limit:api:');
    expect(statusStore.options.prefix).toBe('alt-text-generator:rate-limit:status:');

    await apiStore.options.sendCommand('PING');
    expect(redisClient.sendCommand).toHaveBeenCalledWith(['PING']);

    await provider.close();
    expect(redisClient.quit).toHaveBeenCalledTimes(1);
  });

  it('fails fast when Redis mode is selected without a Redis URL', async () => {
    await expect(initializeRateLimitStoreProvider({
      config: {
        rateLimitStore: {
          kind: 'redis',
          mode: 'redis',
          redisPrefix: 'alt-text-generator:rate-limit:',
          redisUrl: undefined,
        },
      },
    })).rejects.toThrow(/no Redis URL/i);
  });
});
