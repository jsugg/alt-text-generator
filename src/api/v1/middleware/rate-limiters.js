const rateLimit = /** @type {(options: object) => Function} */ (
  /** @type {unknown} */ (require('express-rate-limit'))
);
const config = require('../../../../config');
const {
  RATE_LIMIT_STORE_SCOPES,
} = require('../../../infrastructure/rateLimitStore');

/**
 * @typedef {object} LimiterWindowConfig
 * @property {number} max
 * @property {number} windowMs
 */

/**
 * @typedef {object} RateLimitStoreProvider
 * @property {(scope: string) => unknown} [createStore]
 */

/**
 * @typedef {object} RateLimitAppConfig
 * @property {LimiterWindowConfig} [rateLimit]
 * @property {LimiterWindowConfig} [statusRateLimit]
 */

/**
 * @typedef {object} RateLimiterOptions
 * @property {LimiterWindowConfig} limiterConfig
 * @property {unknown} message
 * @property {string} scope
 * @property {(req: { path: string }) => boolean} [skip]
 * @property {RateLimitStoreProvider} [storeProvider]
 */

const STATUS_ENDPOINT_PATHS = new Set([
  '/api/health',
  '/api/v1/health',
  '/api/ping',
  '/api/v1/ping',
]);

/**
 * @param {unknown} message
 * @returns {unknown}
 */
const buildLimiterMessage = (message) => message;

/**
 * @param {RateLimiterOptions} options
 * @returns {Function}
 */
const buildRateLimiter = ({
  limiterConfig,
  message,
  scope,
  skip,
  storeProvider,
}) => {
  const store = storeProvider?.createStore?.(scope);

  return rateLimit({
    max: limiterConfig.max,
    message: buildLimiterMessage(message),
    skip,
    store,
    windowMs: limiterConfig.windowMs,
  });
};

/**
 * @param {RateLimitAppConfig} [appConfig]
 * @param {RateLimitStoreProvider} [storeProvider]
 * @returns {Function}
 */
const createDefaultRateLimiter = (
  appConfig,
  storeProvider,
) => {
  const resolvedConfig = appConfig ?? config;
  const rateLimitConfig = resolvedConfig.rateLimit ?? config.rateLimit;

  return buildRateLimiter({
    limiterConfig: rateLimitConfig,
    message: 'Too many requests, please try again later.',
    scope: RATE_LIMIT_STORE_SCOPES.API,
    skip: (req) => STATUS_ENDPOINT_PATHS.has(req.path),
    storeProvider,
  });
};

/**
 * @param {RateLimitAppConfig} [appConfig]
 * @param {RateLimitStoreProvider} [storeProvider]
 * @returns {Function}
 */
const createStatusRateLimiter = (
  appConfig,
  storeProvider,
) => {
  const resolvedConfig = appConfig ?? config;
  const statusRateLimitConfig = resolvedConfig.statusRateLimit ?? config.statusRateLimit;

  return buildRateLimiter({
    limiterConfig: statusRateLimitConfig,
    message: 'Too many status requests, please try again later.',
    scope: RATE_LIMIT_STORE_SCOPES.STATUS,
    storeProvider,
  });
};

module.exports = {
  STATUS_ENDPOINT_PATHS,
  createDefaultRateLimiter,
  createStatusRateLimiter,
};
