const ORIGINAL_ENV = process.env;
const {
  DEFAULT_DESCRIPTION_JOB_CLAIM_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_COMPLETED_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_FAILED_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_PENDING_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_POLL_INTERVAL_MS,
  DEFAULT_DESCRIPTION_JOB_REDIS_PREFIX,
  DEFAULT_DESCRIPTION_JOB_WAIT_TIMEOUT_MS,
  DESCRIPTION_JOB_STORE_MODES,
} = require('../../../config/descriptionJobStore');
const {
  DEFAULT_RATE_LIMIT_REDIS_PREFIX,
  DEFAULT_UNIT_LOCAL_REDIS_URL,
} = require('../../../config/rateLimitStore');

const loadConfig = ({ overrides = {}, remove = [] } = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

  remove.forEach((key) => {
    delete process.env[key];
  });

  Object.entries(overrides).forEach(([key, value]) => {
    process.env[key] = value;
  });

  // eslint-disable-next-line global-require
  return require('../../../config');
};

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.resetModules();
});

describe('Unit | Config | Index', () => {
  it('uses the documented defaults when optional env vars are unset', () => {
    const config = loadConfig({
      remove: [
        'TRUST_PROXY_HOPS',
        'WORKER_COUNT',
        'CLUSTER_RESTART_BACKOFF_MS',
        'CLUSTER_RESTART_MAX_BACKOFF_MS',
        'CLUSTER_CRASH_WINDOW_MS',
        'CLUSTER_MAX_CRASHES',
        'CLUSTER_SHUTDOWN_TIMEOUT_MS',
        'SCRAPER_REQUEST_TIMEOUT_MS',
        'SCRAPER_MAX_REDIRECTS',
        'SCRAPER_MAX_CONTENT_LENGTH_BYTES',
        'DESCRIPTION_JOB_STORE',
        'DESCRIPTION_JOB_REDIS_URL',
        'DESCRIPTION_JOB_REDIS_PREFIX',
        'DESCRIPTION_JOB_WAIT_TIMEOUT_MS',
        'DESCRIPTION_JOB_POLL_INTERVAL_MS',
        'DESCRIPTION_JOB_PENDING_TTL_MS',
        'DESCRIPTION_JOB_COMPLETED_TTL_MS',
        'DESCRIPTION_JOB_FAILED_TTL_MS',
        'DESCRIPTION_JOB_CLAIM_TTL_MS',
        'RATE_LIMIT_WINDOW_MS',
        'RATE_LIMIT_MAX',
        'RATE_LIMIT_STORE',
        'RATE_LIMIT_REDIS_TOPOLOGY',
        'RATE_LIMIT_REDIS_PREFIX',
        'RATE_LIMIT_REDIS_URL',
        'REDIS_URL',
        'STATUS_RATE_LIMIT_WINDOW_MS',
        'STATUS_RATE_LIMIT_MAX',
        'API_AUTH_ENABLED',
        'API_AUTH_TOKENS',
      ],
    });

    expect(config.proxy.trustProxyHops).toBe(1);
    expect(config.cluster).toEqual({
      workers: 1,
      restartBackoffMs: 1000,
      maxRestartBackoffMs: 30000,
      crashWindowMs: 60000,
      maxCrashCount: 5,
      shutdownTimeoutMs: 10000,
    });
    expect(config.scraper).toEqual({
      requestTimeoutMs: 10000,
      maxRedirects: 5,
      maxContentLengthBytes: 2 * 1024 * 1024,
    });
    expect(config.rateLimit).toEqual({
      windowMs: 15 * 60 * 1000,
      max: 100,
    });
    expect(config.statusRateLimit).toEqual({
      windowMs: 60 * 1000,
      max: 60,
    });
    expect(config.rateLimitStore).toEqual({
      kind: 'memory',
      mode: 'auto',
      redisTopology: 'external',
      redisPrefix: DEFAULT_RATE_LIMIT_REDIS_PREFIX,
      redisUrl: undefined,
    });
    expect(config.descriptionJobs).toEqual({
      kind: DESCRIPTION_JOB_STORE_MODES.MEMORY,
      mode: DESCRIPTION_JOB_STORE_MODES.AUTO,
      redisPrefix: DEFAULT_DESCRIPTION_JOB_REDIS_PREFIX,
      redisUrl: undefined,
      waitTimeoutMs: DEFAULT_DESCRIPTION_JOB_WAIT_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_DESCRIPTION_JOB_POLL_INTERVAL_MS,
      pendingTtlMs: DEFAULT_DESCRIPTION_JOB_PENDING_TTL_MS,
      completedTtlMs: DEFAULT_DESCRIPTION_JOB_COMPLETED_TTL_MS,
      failedTtlMs: DEFAULT_DESCRIPTION_JOB_FAILED_TTL_MS,
      claimTtlMs: DEFAULT_DESCRIPTION_JOB_CLAIM_TTL_MS,
    });
    expect(config.auth).toEqual({
      enabled: false,
      tokens: [],
    });
    expect(config.swagger).toEqual({
      devServerUrl: 'https://localhost:8443',
      prodServerUrl: 'https://wcag.qcraft.com.br',
    });
  });

  it('parses numeric overrides for worker and scraper controls', () => {
    const config = loadConfig({
      overrides: {
        TRUST_PROXY_HOPS: '2',
        WORKER_COUNT: '4',
        CLUSTER_RESTART_BACKOFF_MS: '1500',
        CLUSTER_RESTART_MAX_BACKOFF_MS: '9000',
        CLUSTER_CRASH_WINDOW_MS: '45000',
        CLUSTER_MAX_CRASHES: '3',
        CLUSTER_SHUTDOWN_TIMEOUT_MS: '7000',
        SCRAPER_REQUEST_TIMEOUT_MS: '2500',
        SCRAPER_MAX_REDIRECTS: '2',
        SCRAPER_MAX_CONTENT_LENGTH_BYTES: '4096',
        DESCRIPTION_JOB_STORE: 'auto',
        DESCRIPTION_JOB_REDIS_PREFIX: 'description-jobs',
        DESCRIPTION_JOB_REDIS_URL: 'redis://jobs.example:6379',
        DESCRIPTION_JOB_WAIT_TIMEOUT_MS: '6000',
        DESCRIPTION_JOB_POLL_INTERVAL_MS: '250',
        DESCRIPTION_JOB_PENDING_TTL_MS: '120000',
        DESCRIPTION_JOB_COMPLETED_TTL_MS: '1800000',
        DESCRIPTION_JOB_FAILED_TTL_MS: '60000',
        DESCRIPTION_JOB_CLAIM_TTL_MS: '45000',
        RATE_LIMIT_WINDOW_MS: '30000',
        RATE_LIMIT_MAX: '50',
        RATE_LIMIT_STORE: 'auto',
        RATE_LIMIT_REDIS_TOPOLOGY: 'external',
        RATE_LIMIT_REDIS_PREFIX: 'redis-rate-limit',
        RATE_LIMIT_REDIS_URL: 'redis://rate-limit.example:6379',
        STATUS_RATE_LIMIT_WINDOW_MS: '45000',
        STATUS_RATE_LIMIT_MAX: '15',
        API_AUTH_ENABLED: 'true',
        API_AUTH_TOKENS: ' token-a,token-b , token-c ',
      },
    });

    expect(config.proxy.trustProxyHops).toBe(2);
    expect(config.cluster).toEqual({
      workers: 4,
      restartBackoffMs: 1500,
      maxRestartBackoffMs: 9000,
      crashWindowMs: 45000,
      maxCrashCount: 3,
      shutdownTimeoutMs: 7000,
    });
    expect(config.scraper).toEqual({
      requestTimeoutMs: 2500,
      maxRedirects: 2,
      maxContentLengthBytes: 4096,
    });
    expect(config.rateLimit).toEqual({
      windowMs: 30000,
      max: 50,
    });
    expect(config.statusRateLimit).toEqual({
      windowMs: 45000,
      max: 15,
    });
    expect(config.rateLimitStore).toEqual({
      kind: 'redis',
      mode: 'auto',
      redisTopology: 'external',
      redisPrefix: 'redis-rate-limit:',
      redisUrl: 'redis://rate-limit.example:6379',
    });
    expect(config.descriptionJobs).toEqual({
      kind: DESCRIPTION_JOB_STORE_MODES.REDIS,
      mode: DESCRIPTION_JOB_STORE_MODES.AUTO,
      redisPrefix: 'description-jobs:',
      redisUrl: 'redis://jobs.example:6379',
      waitTimeoutMs: 6000,
      pollIntervalMs: 250,
      pendingTtlMs: 120000,
      completedTtlMs: 1800000,
      failedTtlMs: 60000,
      claimTtlMs: 45000,
    });
    expect(config.auth).toEqual({
      enabled: true,
      tokens: ['token-a', 'token-b', 'token-c'],
    });
  });

  it('uses the explicit TLS_* settings for HTTPS config', () => {
    const config = loadConfig({
      overrides: {
        TLS_PORT: '9443',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
      },
    });

    expect(config.https).toEqual({
      port: 9443,
      keyPath: 'tls-key',
      certPath: 'tls-cert',
    });
  });

  it('allows auth tokens to stay configured while auth is explicitly disabled', () => {
    const config = loadConfig({
      overrides: {
        API_AUTH_ENABLED: 'false',
        API_AUTH_TOKENS: 'token-a, token-b',
      },
    });

    expect(config.auth).toEqual({
      enabled: false,
      tokens: ['token-a', 'token-b'],
    });
  });

  it('allows the shared REDIS_URL to back rate limiting automatically', () => {
    const config = loadConfig({
      overrides: {
        REDIS_URL: 'redis://shared.example:6379',
      },
      remove: ['RATE_LIMIT_REDIS_URL'],
    });

    expect(config.rateLimitStore).toEqual({
      kind: 'redis',
      mode: 'auto',
      redisTopology: 'external',
      redisPrefix: DEFAULT_RATE_LIMIT_REDIS_PREFIX,
      redisUrl: 'redis://shared.example:6379',
    });
  });

  it('defaults unit-local Redis to localhost when the topology flag is enabled', () => {
    const config = loadConfig({
      overrides: {
        RATE_LIMIT_REDIS_TOPOLOGY: 'unit-local',
      },
      remove: ['RATE_LIMIT_REDIS_URL', 'REDIS_URL'],
    });

    expect(config.rateLimitStore).toEqual({
      kind: 'redis',
      mode: 'auto',
      redisTopology: 'unit-local',
      redisPrefix: DEFAULT_RATE_LIMIT_REDIS_PREFIX,
      redisUrl: DEFAULT_UNIT_LOCAL_REDIS_URL,
    });
  });
});
