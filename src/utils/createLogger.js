// utils/createLogger.js
const { appLogger, serverLogger } = require('./logger');

module.exports.createLogger = (target) => {
  const logger = target === 'server' ? serverLogger : appLogger;
  logger.level = 'debug';
  return logger;
};
