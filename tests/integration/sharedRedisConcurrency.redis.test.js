const { randomUUID } = require('node:crypto');
const { createClient } = require('redis');
const request = require('supertest');

const { createApp } = require('../../src/createApp');
const {
  initializeRateLimitStoreProvider,
} = require('../../src/infrastructure/rateLimitStore');
const {
  createRedisDescriptionJobStore,
} = require('../../src/infrastructure/descriptionJobStore');
const {
  resolveRedisIntegrationRuntime,
  startRedisTestServer,
} = require('../helpers/redisTestServer');

// QE-016 / ATG-QE-03A: prove the shared Redis state behaves atomically when many
// requests/runners hit it at once. The in-memory unit tests cover orchestration
// logic; these cover the actual cross-instance contention the production Redis
// adapters are responsible for.

const TEST_REQUEST_ID = 'redis-concurrency-request-id';
const redisRuntime = resolveRedisIntegrationRuntime();
const describeIfRedis = redisRuntime.enabled ? describe : describe.skip;

jest.setTimeout(20_000);

if (!redisRuntime.enabled) {
  process.stderr.write(`[redis integration] ${redisRuntime.diagnostic}\n`);
}

if (!redisRuntime.enabled && redisRuntime.mode === 'required') {
  throw new Error(redisRuntime.diagnostic);
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

const buildRedisConfig = ({ redisPrefix, redisUrl, max }) => ({
  auth: { enabled: false, tokens: [] },
  azure: {},
  proxy: { trustProxyHops: 1 },
  rateLimit: { windowMs: 60 * 1000, max },
  statusRateLimit: { windowMs: 60 * 1000, max },
  rateLimitStore: {
    kind: 'redis',
    mode: 'redis',
    redisPrefix,
    redisTopology: 'external',
    redisUrl,
  },
  replicate: {},
  scraper: {
    maxContentLengthBytes: 2 * 1024 * 1024,
    maxRedirects: 5,
    requestTimeoutMs: 10_000,
  },
});

const buildRedisKeyPrefix = (scope) => `jest:${scope}:${randomUUID()}:`;

const connectRedisClient = async (redisUrl) => {
  const client = createClient({ url: redisUrl });
  client.on('error', () => {});
  await client.connect();
  return client;
};

describeIfRedis('Integration | Shared Redis Concurrency', () => {
  let redisServer;

  beforeAll(async () => {
    redisServer = await startRedisTestServer({ redisUrl: redisRuntime.redisUrl });
  });

  afterAll(async () => {
    await redisServer?.stop();
  });

  it('admits exactly the rate-limit budget under a concurrent Promise.all burst across instances', async () => {
    const max = 2;
    const burstSize = 6;
    const redisPrefix = buildRedisKeyPrefix('api-burst');
    const firstProvider = await initializeRateLimitStoreProvider({
      config: buildRedisConfig({ redisPrefix, redisUrl: redisServer.redisUrl, max }),
      logger: createAppLogger(),
    });
    const secondProvider = await initializeRateLimitStoreProvider({
      config: buildRedisConfig({ redisPrefix, redisUrl: redisServer.redisUrl, max }),
      logger: createAppLogger(),
    });

    try {
      const { app: firstApp } = createApp({
        appLogger: createAppLogger(),
        requestLogger: createRequestLogger(),
        config: buildRedisConfig({ redisPrefix, redisUrl: redisServer.redisUrl, max }),
        rateLimitStoreProvider: firstProvider,
      });
      const { app: secondApp } = createApp({
        appLogger: createAppLogger(),
        requestLogger: createRequestLogger(),
        config: buildRedisConfig({ redisPrefix, redisUrl: redisServer.redisUrl, max }),
        rateLimitStoreProvider: secondProvider,
      });

      // Alternate instances so the shared counter, not a per-process one, decides.
      const responses = await Promise.all(
        Array.from({ length: burstSize }, (_value, index) => (
          secureGet(index % 2 === 0 ? firstApp : secondApp, '/api/v1/does-not-exist')
        )),
      );
      const statuses = responses.map((response) => response.status);
      const admitted = statuses.filter((status) => status !== 429);
      const limited = statuses.filter((status) => status === 429);

      expect(admitted).toHaveLength(max);
      expect(limited).toHaveLength(burstSize - max);
      admitted.forEach((status) => expect(status).toBe(404));
    } finally {
      await Promise.all([firstProvider.close(), secondProvider.close()]);
    }
  });

  it('lets only one runner win a concurrent claim on a shared description job', async () => {
    const redisPrefix = buildRedisKeyPrefix('job-store');
    const clientA = await connectRedisClient(redisServer.redisUrl);
    const clientB = await connectRedisClient(redisServer.redisUrl);
    const storeA = createRedisDescriptionJobStore({ client: clientA, prefix: redisPrefix });
    const storeB = createRedisDescriptionJobStore({ client: clientB, prefix: redisPrefix });
    const jobId = `page-${randomUUID()}`;
    const claimTtlMs = 30_000;

    try {
      await storeA.set({
        id: jobId,
        jobType: 'page-description',
        model: 'replicate',
        pageUrl: 'https://example.com/page',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      const claims = await Promise.all([
        storeA.claim(jobId, 'runner-a', claimTtlMs),
        storeB.claim(jobId, 'runner-b', claimTtlMs),
      ]);
      const winners = claims.filter(Boolean);

      expect(winners).toHaveLength(1);
      const [winner] = winners;
      expect(['runner-a', 'runner-b']).toContain(winner.runnerId);

      // The losing runner cannot steal the job while the winner's lease is live.
      const loserRunnerId = winner.runnerId === 'runner-a' ? 'runner-b' : 'runner-a';
      await expect(storeB.claim(jobId, loserRunnerId, claimTtlMs)).resolves.toBeNull();

      const persisted = await storeA.get(jobId);
      expect(persisted.runnerId).toBe(winner.runnerId);
    } finally {
      await storeA.close();
      await storeB.close();
    }
  });
});
