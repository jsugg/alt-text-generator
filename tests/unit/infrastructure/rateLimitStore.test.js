const {
  buildFailOpenRateLimitResponse,
  buildRedisStorePrefix,
  createFailOpenStore,
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
        this.increment = jest.fn(async () => {
          await options.sendCommand('PING');
          return buildFailOpenRateLimitResponse(60_000);
        });
        this.decrement = jest.fn().mockResolvedValue(undefined);
        this.options = options;
        this.prefix = options.prefix;
        this.resetKey = jest.fn().mockResolvedValue(undefined);
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
    expect(apiStore.prefix).toBe('alt-text-generator:rate-limit:api:');
    expect(statusStore.prefix).toBe('alt-text-generator:rate-limit:status:');

    await apiStore.increment('client-ip');
    expect(redisClient.sendCommand).toHaveBeenCalledWith(['PING']);

    await provider.close();
    expect(redisClient.quit).toHaveBeenCalledTimes(1);
  });

  it('wraps store operations so request-time store errors fail open', async () => {
    const failingStore = {
      decrement: jest.fn().mockRejectedValue(new Error('decrement failed')),
      get: jest.fn().mockRejectedValue(new Error('get failed')),
      increment: jest.fn().mockRejectedValue(new Error('increment failed')),
      init: jest.fn(),
      prefix: 'alt-text-generator:rate-limit:api:',
      resetAll: jest.fn().mockRejectedValue(new Error('resetAll failed')),
      resetKey: jest.fn().mockRejectedValue(new Error('resetKey failed')),
    };
    const logger = {
      warn: jest.fn(),
    };
    const store = createFailOpenStore({
      logger,
      scope: RATE_LIMIT_STORE_SCOPES.API,
      store: failingStore,
    });

    store.init({ windowMs: 5_000 });

    await expect(store.increment('client-ip')).resolves.toEqual({
      resetTime: expect.any(Date),
      totalHits: 1,
    });
    await expect(store.get('client-ip')).resolves.toBeUndefined();
    await expect(store.decrement('client-ip')).resolves.toBeUndefined();
    await expect(store.resetKey('client-ip')).resolves.toBeUndefined();
    await expect(store.resetAll()).resolves.toBeUndefined();
    expect(store.prefix).toBe('alt-text-generator:rate-limit:api:');
    expect(logger.warn).toHaveBeenCalledTimes(5);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'increment',
      scope: RATE_LIMIT_STORE_SCOPES.API,
      store: 'rate-limit',
    }), 'Rate-limit store operation failed; allowing request to proceed');
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
