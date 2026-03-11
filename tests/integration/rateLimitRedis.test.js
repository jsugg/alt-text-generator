const request = require('supertest');

const { createApp } = require('../../src/createApp');
const {
  initializeRateLimitStoreProvider,
} = require('../../src/infrastructure/rateLimitStore');
const {
  hasRedisServerBinary,
  startRedisTestServer,
} = require('../helpers/redisTestServer');

const TEST_REQUEST_ID = 'redis-test-request-id';
const describeIfRedis = hasRedisServerBinary() ? describe : describe.skip;

jest.setTimeout(15_000);

if (process.env.CI && !hasRedisServerBinary()) {
  throw new Error('redis-server is required in CI for Redis-backed rate-limit tests');
}

const createAppLogger = () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  fatal: jest.fn(),
});

const createRequestLogger = () => {
  const requestLogger = jest.fn((req, res, next) => {
    req.id = TEST_REQUEST_ID;
    req.log = requestLogger.logger;
    res.setHeader('X-Request-Id', TEST_REQUEST_ID);
    next();
  });

  requestLogger.logger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  return requestLogger;
};

const secureGet = (app, path) => request(app)
  .get(path)
  .set('X-Forwarded-Proto', 'https');

const buildRateLimitConfig = ({
  rateLimit = {
    windowMs: 60 * 1000,
    max: 1,
  },
  rateLimitStore,
  statusRateLimit = {
    windowMs: 60 * 1000,
    max: 1,
  },
} = {}) => ({
  auth: {
    enabled: false,
    tokens: [],
  },
  azure: {},
  proxy: {
    trustProxyHops: 1,
  },
  rateLimit,
  rateLimitStore,
  replicate: {},
  scraper: {
    maxContentLengthBytes: 2 * 1024 * 1024,
    maxRedirects: 5,
    requestTimeoutMs: 10_000,
  },
  statusRateLimit,
});

const buildRedisConfig = ({
  redisPrefix,
  redisUrl,
} = {}) => buildRateLimitConfig({
  rateLimitStore: {
    kind: 'redis',
    mode: 'redis',
    redisPrefix,
    redisTopology: 'external',
    redisUrl,
  },
});

describeIfRedis('Redis-backed rate limiting', () => {
  let redisServer;

  beforeAll(async () => {
    redisServer = await startRedisTestServer();
  });

  afterAll(async () => {
    await redisServer?.stop();
  });

  it('shares API rate-limit counters across distinct app instances', async () => {
    const redisPrefix = `jest:api:${Date.now()}:`;
    const firstProvider = await initializeRateLimitStoreProvider({
      config: buildRedisConfig({
        redisPrefix,
        redisUrl: redisServer.redisUrl,
      }),
      logger: createAppLogger(),
    });
    const secondProvider = await initializeRateLimitStoreProvider({
      config: buildRedisConfig({
        redisPrefix,
        redisUrl: redisServer.redisUrl,
      }),
      logger: createAppLogger(),
    });

    try {
      const { app: firstApp } = createApp({
        appLogger: createAppLogger(),
        requestLogger: createRequestLogger(),
        config: buildRedisConfig({
          redisPrefix,
          redisUrl: redisServer.redisUrl,
        }),
        rateLimitStoreProvider: firstProvider,
      });
      const { app: secondApp } = createApp({
        appLogger: createAppLogger(),
        requestLogger: createRequestLogger(),
        config: buildRedisConfig({
          redisPrefix,
          redisUrl: redisServer.redisUrl,
        }),
        rateLimitStoreProvider: secondProvider,
      });

      const firstResponse = await secureGet(firstApp, '/api/v1/does-not-exist');
      const secondResponse = await secureGet(secondApp, '/api/v1/does-not-exist');

      expect(firstResponse.status).toBe(404);
      expect(secondResponse.status).toBe(429);
      expect(secondResponse.text).toContain('Too many requests');
    } finally {
      await Promise.all([
        firstProvider.close(),
        secondProvider.close(),
      ]);
    }
  });

  it('keeps API and status buckets separate while sharing each scope across instances', async () => {
    const redisPrefix = `jest:scope:${Date.now()}:`;
    const firstProvider = await initializeRateLimitStoreProvider({
      config: buildRedisConfig({
        redisPrefix,
        redisUrl: redisServer.redisUrl,
      }),
      logger: createAppLogger(),
    });
    const secondProvider = await initializeRateLimitStoreProvider({
      config: buildRedisConfig({
        redisPrefix,
        redisUrl: redisServer.redisUrl,
      }),
      logger: createAppLogger(),
    });

    try {
      const { app: firstApp } = createApp({
        appLogger: createAppLogger(),
        requestLogger: createRequestLogger(),
        config: buildRedisConfig({
          redisPrefix,
          redisUrl: redisServer.redisUrl,
        }),
        rateLimitStoreProvider: firstProvider,
      });
      const { app: secondApp } = createApp({
        appLogger: createAppLogger(),
        requestLogger: createRequestLogger(),
        config: buildRedisConfig({
          redisPrefix,
          redisUrl: redisServer.redisUrl,
        }),
        rateLimitStoreProvider: secondProvider,
      });

      const firstHealth = await secureGet(firstApp, '/api/health');
      const firstApi = await secureGet(secondApp, '/api/v1/does-not-exist');
      const secondHealth = await secureGet(secondApp, '/api/health');

      expect(firstHealth.status).toBe(200);
      expect(firstApi.status).toBe(404);
      expect(secondHealth.status).toBe(429);
      expect(secondHealth.text).toContain('Too many status requests');
    } finally {
      await Promise.all([
        firstProvider.close(),
        secondProvider.close(),
      ]);
    }
  });
});
