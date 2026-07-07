const express = require('express');
const {
  asyncHandler,
  notFoundHandler,
} = require('../middleware/error-handler');

/**
 * @typedef {object} HealthController
 * @property {Function} index
 * @property {Function} ping
 * @property {Function} health
 */

/**
 * @typedef {object} ScraperControllerLike
 * @property {Function} getImages
 */

/**
 * @typedef {object} DescriptionControllerLike
 * @property {Function} describe
 * @property {Function} getDescriptionJob
 * @property {Function} getPageDescriptionJob
 * @property {Function} describePage
 */

/**
 * @typedef {object} RouteLogger
 * @property {(...args: any[]) => void} info
 */

/**
 * Registers all API routes onto an Express router.
 *
 * Controllers are passed in — this module only wires HTTP paths to handlers.
 * Business logic lives in controllers and services, not here.
 *
 * @param {object} controllers
 * @param {HealthController} controllers.health - healthController
 * @param {ScraperControllerLike} controllers.scraper - ScraperController instance
 * @param {DescriptionControllerLike} controllers.description - DescriptionController instance
 * @param {Function} [controllers.statusRateLimiter] - rate limiter for status routes
 * @param {RouteLogger} logger - app logger instance
 * @returns {object} Express Router
 */
module.exports = ({
  health,
  scraper,
  description,
  statusRateLimiter,
}, logger) => {
  const apiRouter = express.Router();
  const statusRouteMiddleware = statusRateLimiter ? [statusRateLimiter] : [];

  apiRouter.get('/', health.index);
  apiRouter.get(['/api/ping', '/api/v1/ping'], ...statusRouteMiddleware, health.ping);
  apiRouter.get(['/api/health', '/api/v1/health'], ...statusRouteMiddleware, health.health);

  apiRouter.get(
    ['/api/scraper/images', '/api/v1/scraper/images'],
    asyncHandler(scraper.getImages),
  );

  apiRouter.get(
    ['/api/accessibility/description', '/api/v1/accessibility/description'],
    asyncHandler(description.describe),
  );

  apiRouter.get(
    ['/api/accessibility/description-jobs/:jobId', '/api/v1/accessibility/description-jobs/:jobId'],
    asyncHandler(description.getDescriptionJob),
  );

  apiRouter.get(
    ['/api/accessibility/page-description-jobs/:jobId', '/api/v1/accessibility/page-description-jobs/:jobId'],
    asyncHandler(description.getPageDescriptionJob),
  );

  apiRouter.get(
    ['/api/accessibility/descriptions', '/api/v1/accessibility/descriptions'],
    asyncHandler(description.describePage),
  );

  // 404 fallback
  apiRouter.use(notFoundHandler);

  logger.info('API routes loaded');

  return apiRouter;
};
