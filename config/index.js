// config/index.js
// Single source of truth for all configuration.
// All other modules read from here instead of process.env directly.

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

  outboundTls: {
    caBundleFile:
      process.env.OUTBOUND_CA_BUNDLE_FILE
      || process.env.NODE_EXTRA_CA_CERTS,
  },

  replicate: {
    apiToken: process.env.REPLICATE_API_TOKEN,
    apiEndpoint: process.env.REPLICATE_API_ENDPOINT,
    userAgent: process.env.REPLICATE_USER_AGENT || 'alt-text-generator/1.0.0',
    modelOwner: process.env.REPLICATE_MODEL_OWNER || 'rmokady',
    modelName: process.env.REPLICATE_MODEL_NAME || 'clip_prefix_caption',
    modelVersion:
      process.env.REPLICATE_MODEL_VERSION
      || '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8',
  },

  azure: {
    apiEndpoint: process.env.ACV_API_ENDPOINT,
    subscriptionKey:
      process.env.ACV_SUBSCRIPTION_KEY
      || process.env.ACV_API_KEY,
    language: process.env.ACV_LANGUAGE || 'en',
    maxCandidates: toNumber(process.env.ACV_MAX_CANDIDATES, 4),
  },

  rateLimit: {
    windowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: toNumber(process.env.RATE_LIMIT_MAX, 100),
  },

  swagger: {
    devServerUrl: process.env.SWAGGER_DEV_URL || 'https://localhost:8443',
    prodServerUrl: process.env.SWAGGER_PROD_URL || 'https://wcag.qcraft.dev',
  },

  logging: {
    level:
      process.env.LOG_LEVEL
      || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  },
};
