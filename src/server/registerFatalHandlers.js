const util = require('util');

/**
 * @typedef {{
 *   fatal: (details: object | string, message?: string) => void,
 *   error: (details: object | string, message?: string) => void,
 * }} FatalLogger
 */

/**
 * @typedef {(options: { exitCode?: number, reason?: string, signal?: string }) => unknown
 * } ShutdownHandler
 */

/** @param {unknown} reason */
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
 * @param {() => (ShutdownHandler | null | undefined)} params.getShutdownHandler
 *   returns the active shutdown fn
 * @param {FatalLogger} params.logger - pino logger
 * @param {NodeJS.Process} [params.processRef] - process-like object for tests
 * @returns {Function}
 */
const registerFatalHandlers = ({
  getShutdownHandler,
  logger,
  processRef = process,
}) => {
  let fatalInProgress = false;

  /**
   * @param {object} details
   * @param {string} message
   */
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

  /** @param {Error} error */
  const onUncaughtException = (error) => {
    handleFatal({ err: error }, 'Uncaught exception');
  };
  /** @param {unknown} reason */
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
