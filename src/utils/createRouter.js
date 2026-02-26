const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../../config/swagger');

/**
 * Builds the main application router.
 *
 * The apiRouter is passed in rather than required internally so that:
 *  - The dependency graph is explicit (visible in the composition root)
 *  - This module stays testable without loading the full route tree
 *
 * @param {object} serverLogger - pino-http logger instance
 * @param {object} apiRouter - Express router with all API routes mounted
 * @returns {object} Express Router
 */
module.exports.createRouter = (serverLogger, apiRouter) => {
  const mainRouter = express.Router();

  const swaggerRouter = express.Router();
  swaggerRouter.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  mainRouter.use(swaggerRouter);
  mainRouter.use(apiRouter);

  serverLogger.logger.debug('Main router created');

  return mainRouter;
};
