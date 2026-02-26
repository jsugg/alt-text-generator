// config/index.js
// Single source of truth for all configuration.
// All other modules read from here instead of process.env directly.

module.exports = {
  env: process.env.NODE_ENV || 'development',

  http: {
    port: Number(process.env.PORT) || 8080,
  },

  https: {
    port: Number(process.env.TLS_PORT) || 8443,
    keyPath: process.env.TLS_KEY || '../../certs/localhost-key.pem',
    certPath: process.env.TLS_CERT || '../../certs/localhost.pem',
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
    apiKey: process.env.ACV_API_KEY,
    apiEndpoint: process.env.ACV_API_ENDPOINT,
    subscriptionKey: process.env.ACV_SUBSCRIPTION_KEY,
    language: process.env.ACV_LANGUAGE || 'en',
    maxCandidates: Number(process.env.ACV_MAX_CANDIDATES) || 4,
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 100,
  },

  swagger: {
    devServerUrl: process.env.SWAGGER_DEV_URL || 'https://localhost:8443',
    prodServerUrl: process.env.SWAGGER_PROD_URL || 'https://wcag.qcraft.dev',
  },

  logging: {
    level:
      process.env.LOG_LEVEL
      || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    logsDir: process.env.LOGS_DIR || './logs',
  },
};
