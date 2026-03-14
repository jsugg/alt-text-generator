// config/index.js
// Single source of truth for all configuration.
// All other modules read from here instead of process.env directly.

const { buildRateLimitStoreConfig } = require('./rateLimitStore');
const { buildDescriptionJobStoreConfig } = require('./descriptionJobStore');
const { buildProviderConfigSections } = require('./providerCatalog');

const toNumber = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const toOptionalNumber = (value) => {
  if (value === undefined) {
    return undefined;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
};

const toOptionalBoolean = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return undefined;
};

const toList = (value) => {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const authTokens = toList(process.env.API_AUTH_TOKENS);
const explicitApiAuthEnabled = toOptionalBoolean(process.env.API_AUTH_ENABLED);
const rateLimitStore = buildRateLimitStoreConfig(process.env);

module.exports = {
  env: process.env.NODE_ENV || 'development',

  http: {
    port: Number(process.env.PORT) || 8080,
  },

  https: {
    port: Number(process.env.TLS_PORT) || 8443,
    keyPath: process.env.TLS_KEY,
    certPath: process.env.TLS_CERT,
  },

  proxy: {
    trustProxyHops: toOptionalNumber(process.env.TRUST_PROXY_HOPS) ?? 1,
  },

  cluster: {
    workers: toOptionalNumber(process.env.WORKER_COUNT) ?? 1,
    restartBackoffMs: toNumber(process.env.CLUSTER_RESTART_BACKOFF_MS, 1000),
    maxRestartBackoffMs: toNumber(
      process.env.CLUSTER_RESTART_MAX_BACKOFF_MS,
      30000,
    ),
    crashWindowMs: toNumber(process.env.CLUSTER_CRASH_WINDOW_MS, 60000),
    maxCrashCount: toNumber(process.env.CLUSTER_MAX_CRASHES, 5),
    shutdownTimeoutMs: toNumber(
      process.env.CLUSTER_SHUTDOWN_TIMEOUT_MS,
      10000,
    ),
  },

  scraper: {
    requestTimeoutMs: toNumber(process.env.SCRAPER_REQUEST_TIMEOUT_MS, 10000),
    maxRedirects: toNumber(process.env.SCRAPER_MAX_REDIRECTS, 5),
    maxContentLengthBytes: toNumber(
      process.env.SCRAPER_MAX_CONTENT_LENGTH_BYTES,
      2 * 1024 * 1024,
    ),
  },

  pageDescription: {
    concurrency: toNumber(process.env.PAGE_DESCRIPTION_CONCURRENCY, 3),
  },

  descriptionJobs: buildDescriptionJobStoreConfig(process.env),

  outboundTls: {
    caBundleFile:
      process.env.OUTBOUND_CA_BUNDLE_FILE
      || process.env.NODE_EXTRA_CA_CERTS,
  },

  ...buildProviderConfigSections(process.env),

  rateLimit: {
    windowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: toNumber(process.env.RATE_LIMIT_MAX, 100),
  },

  statusRateLimit: {
    windowMs: toNumber(process.env.STATUS_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    max: toNumber(process.env.STATUS_RATE_LIMIT_MAX, 60),
  },

  rateLimitStore,

  auth: {
    enabled: explicitApiAuthEnabled ?? authTokens.length > 0,
    tokens: authTokens,
  },

  swagger: {
    devServerUrl: process.env.SWAGGER_DEV_URL || 'https://localhost:8443',
    prodServerUrl: process.env.SWAGGER_PROD_URL || 'https://wcag.qcraft.com.br',
  },

  logging: {
    level:
      process.env.LOG_LEVEL
      || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  },
};
