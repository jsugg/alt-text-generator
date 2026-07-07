const helmet = /** @type {typeof import('helmet')['default']} */ (
  /** @type {unknown} */ (require('helmet'))
);
const { createDefaultRateLimiter } = require('../api/v1/middleware/rate-limiters');

/**
 * @param {{ use: (...args: any[]) => unknown }} app - Express application
 * @param {Function} requestLogger - pino-http request logger middleware
 * @param {object} appConfig - resolved app config
 * @param {object} rateLimitStoreProvider - rate-limit store provider
 * @returns {void}
 */
module.exports.applyMiddlewares = (
  app,
  requestLogger,
  appConfig,
  rateLimitStoreProvider,
) => {
  app.use(requestLogger);
  app.use(helmet());
  app.use(createDefaultRateLimiter(appConfig, rateLimitStoreProvider));
};
