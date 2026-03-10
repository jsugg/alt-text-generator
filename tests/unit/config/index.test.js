const ORIGINAL_ENV = process.env;

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

describe('config', () => {
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
        'RATE_LIMIT_WINDOW_MS',
        'RATE_LIMIT_MAX',
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
    expect(config.auth).toEqual({
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
        RATE_LIMIT_WINDOW_MS: '30000',
        RATE_LIMIT_MAX: '50',
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
    expect(config.auth).toEqual({
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
});
