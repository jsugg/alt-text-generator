const helmet = require('helmet');
const { createDefaultRateLimiter } = require('../api/v1/middleware/rate-limiters');

module.exports.applyMiddlewares = (app, requestLogger, appConfig) => {
  app.use(requestLogger);
  app.use(helmet());
  app.use(createDefaultRateLimiter(appConfig));
};
