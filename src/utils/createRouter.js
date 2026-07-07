const express = require('express');
const { createProviderValidationRouter } = require('./createProviderValidationRouter');

/**
 * @typedef {object} SwaggerRouter
 * @property {(path: string, handler: (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown) => unknown} use
 */

/**
 * @typedef {object} RouterLogger
 * @property {(...args: any[]) => void} debug
 */

const createSwaggerRouter = () => {
  const swaggerRouter = /** @type {SwaggerRouter} */ (express.Router());
  let swaggerUiServe = /** @type {any} */ (null);
  let swaggerUiMiddleware = /** @type {any} */ (null);

  swaggerRouter.use('/api-docs', (req, res, next) => {
    if (!swaggerUiMiddleware) {
      // Lazy-load the UI package so regular startup does not pull the docs bundle
      // into memory unless the docs route is actually requested.
      // eslint-disable-next-line global-require
      const swaggerUi = require('swagger-ui-express');
      // Lazy-load the spec so regular startup and test paths do not build it.
      // eslint-disable-next-line global-require
      const swaggerSpec = require('../../config/swagger');
      swaggerUiServe = Array.isArray(swaggerUi.serve)
        ? swaggerUi.serve
        : [swaggerUi.serve];
      swaggerUiMiddleware = swaggerUi.setup(swaggerSpec);
    }

    let middlewareIndex = 0;
    /** @param {unknown} [error] */
    const runSwaggerServe = (error) => {
      if (error) {
        return next(error);
      }

      const serveMiddleware = swaggerUiServe[middlewareIndex];
      middlewareIndex += 1;

      if (!serveMiddleware) {
        return swaggerUiMiddleware(req, res, next);
      }

      return serveMiddleware(req, res, runSwaggerServe);
    };

    return runSwaggerServe();
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
 * @param {RouterLogger} logger - app logger instance
 * @param {object} apiRouter - Express router with all API routes mounted
 * @returns {object} Express Router
 */
module.exports.createRouter = (logger, apiRouter) => {
  const mainRouter = express.Router();
  const providerValidationRouter = createProviderValidationRouter();
  const swaggerRouter = createSwaggerRouter();

  mainRouter.use(providerValidationRouter);
  mainRouter.use(swaggerRouter);
  mainRouter.use(apiRouter);

  logger.debug('Main router created');

  return mainRouter;
};
