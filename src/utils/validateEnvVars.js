const Joi = require('joi');

const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().default(8080),
  TLS_PORT: Joi.number().default(8443),
  WORKER_COUNT: Joi.number().integer().min(1).optional(),

  // TLS is optional when the platform terminates HTTPS upstream.
  TLS_KEY: Joi.string().optional(),
  TLS_CERT: Joi.string().optional(),
  OUTBOUND_CA_BUNDLE_FILE: Joi.string().optional(),

  // Replicate is required for core functionality
  REPLICATE_API_TOKEN: Joi.string().required(),
  REPLICATE_API_ENDPOINT: Joi.string().uri().optional(),
  REPLICATE_USER_AGENT: Joi.string().optional(),
  REPLICATE_MODEL_OWNER: Joi.string().optional(),
  REPLICATE_MODEL_NAME: Joi.string().optional(),
  REPLICATE_MODEL_VERSION: Joi.string().optional(),

  // Scraper HTTP safeguards
  SCRAPER_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1).optional(),
  SCRAPER_MAX_REDIRECTS: Joi.number().integer().min(0).optional(),
  SCRAPER_MAX_CONTENT_LENGTH_BYTES: Joi.number().integer().min(1).optional(),

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
    .optional(),
  LOGS_DIR: Joi.string().optional(),

  // Azure Computer Vision (optional provider)
  ACV_API_KEY: Joi.string().optional(),
  ACV_API_ENDPOINT: Joi.string().uri().optional(),
  ACV_SUBSCRIPTION_KEY: Joi.string().optional(),
  ACV_LANGUAGE: Joi.string().optional(),
  ACV_MAX_CANDIDATES: Joi.number().optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().optional(),
  RATE_LIMIT_MAX: Joi.number().optional(),

  // Swagger
  SWAGGER_DEV_URL: Joi.string().uri().optional(),
  SWAGGER_PROD_URL: Joi.string().uri().optional(),
})
  .and('TLS_KEY', 'TLS_CERT')
  .unknown();

const validateEnvVars = () => {
  const { error } = envVarsSchema.validate(process.env);
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }
};

module.exports = { validateEnvVars };
