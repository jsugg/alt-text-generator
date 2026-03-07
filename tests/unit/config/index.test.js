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
        'WORKER_COUNT',
        'SCRAPER_REQUEST_TIMEOUT_MS',
        'SCRAPER_MAX_REDIRECTS',
        'SCRAPER_MAX_CONTENT_LENGTH_BYTES',
        'RATE_LIMIT_WINDOW_MS',
        'RATE_LIMIT_MAX',
      ],
    });

    expect(config.cluster.workers).toBeUndefined();
    expect(config.scraper).toEqual({
      requestTimeoutMs: 10000,
      maxRedirects: 5,
      maxContentLengthBytes: 2 * 1024 * 1024,
    });
    expect(config.rateLimit).toEqual({
      windowMs: 15 * 60 * 1000,
      max: 100,
    });
  });

  it('parses numeric overrides for worker and scraper controls', () => {
    const config = loadConfig({
      overrides: {
        WORKER_COUNT: '4',
        SCRAPER_REQUEST_TIMEOUT_MS: '2500',
        SCRAPER_MAX_REDIRECTS: '2',
        SCRAPER_MAX_CONTENT_LENGTH_BYTES: '4096',
        RATE_LIMIT_WINDOW_MS: '30000',
        RATE_LIMIT_MAX: '50',
      },
    });

    expect(config.cluster.workers).toBe(4);
    expect(config.scraper).toEqual({
      requestTimeoutMs: 2500,
      maxRedirects: 2,
      maxContentLengthBytes: 4096,
    });
    expect(config.rateLimit).toEqual({
      windowMs: 30000,
      max: 50,
    });
  });
});
