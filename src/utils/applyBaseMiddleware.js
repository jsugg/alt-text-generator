const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../../config');

module.exports.applyMiddlewares = (app) => {
  app.use(helmet());

  app.use(rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: 'Too many requests, please try again later.',
  }));
};
