const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../../config/swagger');

module.exports.createRouter = (serverLogger) => {
  const mainRouter = express.Router();
  // eslint-disable-next-line global-require
  const apiRouter = require('../api/v1/routes/api')(serverLogger);

  const swaggerRouter = express.Router();
  swaggerRouter.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  mainRouter.use((req, res, next) => {
    req.log = serverLogger;
    next();
  });

  mainRouter.use(swaggerRouter);
  mainRouter.use(apiRouter);

  return mainRouter;
};
