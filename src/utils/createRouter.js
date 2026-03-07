const express = require('express');
const swaggerUi = require('swagger-ui-express');

const createSwaggerRouter = () => {
  const swaggerRouter = express.Router();
  let swaggerUiMiddleware = null;

  swaggerRouter.use('/api-docs', swaggerUi.serve, (req, res, next) => {
    if (!swaggerUiMiddleware) {
      // Lazy-load the spec so regular startup and test paths do not build it.
      // eslint-disable-next-line global-require
      const swaggerSpec = require('../../config/swagger');
      swaggerUiMiddleware = swaggerUi.setup(swaggerSpec);
    }

    return swaggerUiMiddleware(req, res, next);
  });

  return swaggerRouter;
};

/**
 * Builds the main application router.
 *
 * The apiRouter is passed in rather than required internally so that:
 *  - The dependency graph is explicit (visible in the composition root)
 *  - This module stays testable without loading the full route tree
 *
 * @param {object} logger - app logger instance
 * @param {object} apiRouter - Express router with all API routes mounted
 * @returns {object} Express Router
 */
module.exports.createRouter = (logger, apiRouter) => {
  const mainRouter = express.Router();
  const swaggerRouter = createSwaggerRouter();

  mainRouter.use(swaggerRouter);
  mainRouter.use(apiRouter);

  logger.debug('Main router created');

  return mainRouter;
};
