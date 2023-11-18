// utils/createLogger.js
const { appLogger, serverLogger } = require('./logger');

module.exports.createLogger = () => {
  const logger = process.env.NODE_ENV === 'production' ? serverLogger : appLogger;
  logger.level = 'debug';
  return logger;
};
