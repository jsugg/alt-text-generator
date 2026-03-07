const express = require('express');

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

  apiRouter.get(['/api/ping', '/api/v1/ping'], health.ping);
  apiRouter.get(['/api/health', '/api/v1/health'], health.health);

  apiRouter.get(
    ['/api/scrapper/images', '/api/v1/scrapper/images'],
    scraper.getImages,
  );

  apiRouter.get(
    ['/api/accessibility/description', '/api/v1/accessibility/description'],
    description.describe,
  );

  apiRouter.get(
    ['/api/accessibility/descriptions', '/api/v1/accessibility/descriptions'],
    description.describePage,
  );

  // 404 fallback
  apiRouter.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  logger.info('API routes loaded');

  return apiRouter;
};
