const express = require('express');
const {
  asyncHandler,
  notFoundHandler,
} = require('../middleware/error-handler');

/**
 * Registers all API routes onto an Express router.
 *
 * Controllers are passed in — this module only wires HTTP paths to handlers.
 * Business logic lives in controllers and services, not here.
 *
 * @param {object} controllers
 * @param {object} controllers.health - healthController
 * @param {object} controllers.scraper - ScraperController instance
 * @param {object} controllers.description - DescriptionController instance
 * @param {object} logger - app logger instance
 * @returns {object} Express Router
 */
module.exports = ({ health, scraper, description }, logger) => {
  const apiRouter = express.Router();

  apiRouter.get('/', health.index);
  apiRouter.get(['/api/ping', '/api/v1/ping'], health.ping);
  apiRouter.get(['/api/health', '/api/v1/health'], health.health);

  apiRouter.get(
    ['/api/scraper/images', '/api/v1/scraper/images'],
    asyncHandler(scraper.getImages),
  );

  apiRouter.get(
    ['/api/accessibility/description', '/api/v1/accessibility/description'],
    asyncHandler(description.describe),
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
