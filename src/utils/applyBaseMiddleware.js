const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../../config');

const RATE_LIMIT_EXEMPT_PATHS = new Set([
  '/api/health',
  '/api/v1/health',
]);

module.exports.applyMiddlewares = (app, requestLogger, appConfig = config) => {
  const rateLimitConfig = appConfig.rateLimit ?? config.rateLimit;

  app.use(requestLogger);
  app.use(helmet());

  app.use(rateLimit({
    windowMs: rateLimitConfig.windowMs,
    max: rateLimitConfig.max,
    message: 'Too many requests, please try again later.',
    skip: (req) => RATE_LIMIT_EXEMPT_PATHS.has(req.path),
  }));
};
