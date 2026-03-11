const rateLimit = require('express-rate-limit');
const config = require('../../../../config');

const STATUS_ENDPOINT_PATHS = new Set([
  '/api/health',
  '/api/v1/health',
  '/api/ping',
  '/api/v1/ping',
]);

const buildLimiterMessage = (message) => message;

const createDefaultRateLimiter = (appConfig = config) => {
  const rateLimitConfig = appConfig.rateLimit ?? config.rateLimit;

  return rateLimit({
    windowMs: rateLimitConfig.windowMs,
    max: rateLimitConfig.max,
    message: buildLimiterMessage('Too many requests, please try again later.'),
    skip: (req) => STATUS_ENDPOINT_PATHS.has(req.path),
  });
};

const createStatusRateLimiter = (appConfig = config) => {
  const statusRateLimitConfig = appConfig.statusRateLimit ?? config.statusRateLimit;

  return rateLimit({
    windowMs: statusRateLimitConfig.windowMs,
    max: statusRateLimitConfig.max,
    message: buildLimiterMessage('Too many status requests, please try again later.'),
  });
};

module.exports = {
  STATUS_ENDPOINT_PATHS,
  createDefaultRateLimiter,
  createStatusRateLimiter,
};
