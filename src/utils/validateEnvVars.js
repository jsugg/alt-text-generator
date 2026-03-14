const Joi = require('joi');
const {
  buildProviderEnvSchema,
  getConfiguredProvidersFromEnv,
  getProviderCatalog,
  validateProviderEnv,
} = require('../../config/providerCatalog');

const {
  buildDescriptionJobStoreConfig,
  DESCRIPTION_JOB_STORE_MODES,
} = require('../../config/descriptionJobStore');

const {
  buildRateLimitStoreConfig,
  RATE_LIMIT_REDIS_TOPOLOGIES,
  RATE_LIMIT_STORE_MODES,
} = require('../../config/rateLimitStore');

const parseAuthTokens = (value) => {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
};

const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().default(8080),
  TLS_PORT: Joi.number().default(8443),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).optional(),
  WORKER_COUNT: Joi.number().integer().min(1).optional(),
  CLUSTER_RESTART_BACKOFF_MS: Joi.number().integer().min(1).optional(),
  CLUSTER_RESTART_MAX_BACKOFF_MS: Joi.number().integer().min(1).optional(),
  CLUSTER_CRASH_WINDOW_MS: Joi.number().integer().min(1).optional(),
  CLUSTER_MAX_CRASHES: Joi.number().integer().min(1).optional(),
  CLUSTER_SHUTDOWN_TIMEOUT_MS: Joi.number().integer().min(1).optional(),
  REDIS_URL: Joi.string().pattern(/^rediss?:\/\//).optional(),

  // TLS certs are required in production
  TLS_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  TLS_CERT: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OUTBOUND_CA_BUNDLE_FILE: Joi.string().optional(),

  // Scraper HTTP safeguards
  SCRAPER_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1).optional(),
  SCRAPER_MAX_REDIRECTS: Joi.number().integer().min(0).optional(),
  SCRAPER_MAX_CONTENT_LENGTH_BYTES: Joi.number().integer().min(1).optional(),
  DESCRIPTION_JOB_STORE: Joi.string()
    .valid(...Object.values(DESCRIPTION_JOB_STORE_MODES))
    .optional(),
  DESCRIPTION_JOB_REDIS_URL: Joi.string().pattern(/^rediss?:\/\//).optional(),
  DESCRIPTION_JOB_REDIS_PREFIX: Joi.string().min(1).optional(),
  DESCRIPTION_JOB_WAIT_TIMEOUT_MS: Joi.number().integer().min(1).optional(),
  DESCRIPTION_JOB_POLL_INTERVAL_MS: Joi.number().integer().min(1).optional(),
  DESCRIPTION_JOB_PENDING_TTL_MS: Joi.number().integer().min(1).optional(),
  DESCRIPTION_JOB_COMPLETED_TTL_MS: Joi.number().integer().min(1).optional(),
  DESCRIPTION_JOB_FAILED_TTL_MS: Joi.number().integer().min(1).optional(),
  DESCRIPTION_JOB_CLAIM_TTL_MS: Joi.number().integer().min(1).optional(),

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
    .optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().optional(),
  RATE_LIMIT_MAX: Joi.number().optional(),
  RATE_LIMIT_STORE: Joi.string()
    .valid(...Object.values(RATE_LIMIT_STORE_MODES))
    .optional(),
  RATE_LIMIT_REDIS_TOPOLOGY: Joi.string()
    .valid(...Object.values(RATE_LIMIT_REDIS_TOPOLOGIES))
    .optional(),
  RATE_LIMIT_REDIS_URL: Joi.string().pattern(/^rediss?:\/\//).optional(),
  RATE_LIMIT_REDIS_PREFIX: Joi.string().min(1).optional(),
  STATUS_RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1).optional(),
  STATUS_RATE_LIMIT_MAX: Joi.number().integer().min(1).optional(),
  PAGE_DESCRIPTION_CONCURRENCY: Joi.number().integer().min(1).optional(),

  // Optional API access control
  API_AUTH_ENABLED: Joi.string().valid('true', 'false').optional(),
  API_AUTH_TOKENS: Joi.string().optional(),

  // Swagger
  SWAGGER_DEV_URL: Joi.string().uri().optional(),
  SWAGGER_PROD_URL: Joi.string().uri().optional(),
  ...buildProviderEnvSchema(Joi),
}).unknown();

const validateEnvVars = () => {
  const { error } = envVarsSchema.validate(process.env);
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }

  const providerValidationErrors = validateProviderEnv(process.env);
  const configuredProviders = getConfiguredProvidersFromEnv(process.env);
  const authTokens = parseAuthTokens(process.env.API_AUTH_TOKENS);
  const workerCount = Number(process.env.WORKER_COUNT ?? 1);
  const descriptionJobs = buildDescriptionJobStoreConfig(process.env);
  const rateLimitStore = buildRateLimitStoreConfig(process.env);

  if (providerValidationErrors.length > 0) {
    throw new Error(providerValidationErrors[0]);
  }

  if (configuredProviders.length === 0) {
    const providerHints = getProviderCatalog()
      .map((provider) => provider.startupHint)
      .join(', or set ');

    throw new Error(
      `Config validation error: at least one provider must be configured. Set ${providerHints}`,
    );
  }

  if (
    process.env.API_AUTH_ENABLED === 'true'
    && authTokens.length === 0
  ) {
    throw new Error(
      'Config validation error: API_AUTH_ENABLED=true requires API_AUTH_TOKENS '
        + 'to contain at least one non-empty token',
    );
  }

  if (
    process.env.API_AUTH_ENABLED !== 'false'
    && process.env.API_AUTH_TOKENS !== undefined
    && authTokens.length === 0
  ) {
    throw new Error(
      'Config validation error: API_AUTH_TOKENS must contain at least one '
        + 'non-empty token when auth is enabled',
    );
  }

  if (
    process.env.CLUSTER_RESTART_BACKOFF_MS
    && process.env.CLUSTER_RESTART_MAX_BACKOFF_MS
    && Number(process.env.CLUSTER_RESTART_MAX_BACKOFF_MS)
      < Number(process.env.CLUSTER_RESTART_BACKOFF_MS)
  ) {
    throw new Error(
      'Config validation error: CLUSTER_RESTART_MAX_BACKOFF_MS must be greater '
        + 'than or equal to CLUSTER_RESTART_BACKOFF_MS',
    );
  }

  if (
    descriptionJobs.mode === DESCRIPTION_JOB_STORE_MODES.REDIS
    && !descriptionJobs.redisUrl
  ) {
    throw new Error(
      'Config validation error: DESCRIPTION_JOB_STORE=redis requires DESCRIPTION_JOB_REDIS_URL '
        + 'or REDIS_URL or RATE_LIMIT_REDIS_URL to be configured',
    );
  }

  if (
    rateLimitStore.mode === RATE_LIMIT_STORE_MODES.REDIS
    && !rateLimitStore.redisUrl
  ) {
    throw new Error(
      'Config validation error: RATE_LIMIT_STORE=redis requires RATE_LIMIT_REDIS_URL '
        + 'or REDIS_URL to be configured',
    );
  }

  if (
    workerCount > 1
    && rateLimitStore.kind !== RATE_LIMIT_STORE_MODES.REDIS
  ) {
    throw new Error(
      'Config validation error: WORKER_COUNT greater than 1 requires a shared '
        + 'Redis-backed rate-limit store. Set RATE_LIMIT_STORE=redis or auto and '
        + 'configure RATE_LIMIT_REDIS_URL or REDIS_URL',
    );
  }
};

module.exports = { validateEnvVars };
