const util = require('util');

const normalizeUnhandledRejection = (reason) => (
  reason instanceof Error
    ? { err: reason }
    : {
      err: new Error(`Unhandled promise rejection: ${util.inspect(reason)}`),
      reason,
    }
);

/**
 * Registers fatal process handlers and routes them through the active shutdown
 * handler when one exists.
 *
 * @param {object} params - handler dependencies
 * @param {Function} params.getShutdownHandler - returns the active shutdown fn
 * @param {object} params.logger - pino logger
 * @param {NodeJS.Process} [params.processRef] - process-like object for tests
 * @returns {Function}
 */
const registerFatalHandlers = ({
  getShutdownHandler,
  logger,
  processRef = process,
}) => {
  let fatalInProgress = false;

  const handleFatal = (details, message) => {
    if (fatalInProgress) {
      return;
    }

    fatalInProgress = true;
    logger.fatal(details, message);

    const shutdown = getShutdownHandler();
    if (!shutdown) {
      processRef.exit(1);
      return;
    }

    Promise.resolve(shutdown({
      exitCode: 1,
      reason: 'fatal',
      signal: message,
    })).catch((error) => {
      logger.error({ err: error }, 'Fatal shutdown failed');
      processRef.exit(1);
    });
  };

  const onUncaughtException = (error) => {
    handleFatal({ err: error }, 'Uncaught exception');
  };
  const onUnhandledRejection = (reason) => {
    handleFatal(normalizeUnhandledRejection(reason), 'Unhandled promise rejection');
  };

  processRef.on('uncaughtException', onUncaughtException);
  processRef.on('unhandledRejection', onUnhandledRejection);

  return () => {
    processRef.off('uncaughtException', onUncaughtException);
    processRef.off('unhandledRejection', onUnhandledRejection);
  };
};

module.exports = {
  normalizeUnhandledRejection,
  registerFatalHandlers,
};
