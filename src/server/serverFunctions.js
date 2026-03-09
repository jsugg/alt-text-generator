const http = require('http');
const https = require('https');

module.exports.createHttpServer = (app) => http.createServer(app);

/**
 * Creates an HTTPS server.
 * A credentials loader can provide PEM strings or Buffers.
 *
 * @param {object} app - Express application
 * @param {function} [loadTlsCredentials] - TLS credential loader
 * @returns {https.Server}
 */
module.exports.createHttpsServer = (app, loadTlsCredentials = () => ({
  key: process.env.TLS_KEY,
  cert: process.env.TLS_CERT,
})) => {
  const { key, cert } = loadTlsCredentials();
  return https.createServer({ key, cert }, app);
};

module.exports.startServer = (server, port, logger) => {
  server.listen(port, () => {
    logger.info({ port }, 'Server listening');
  });
};

module.exports.closeServers = async (servers) => {
  await Promise.all(
    servers.map((server) => new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    })),
  );
};

/**
 * Registers SIGTERM / SIGINT handlers that close all servers gracefully.
 * Returns the shared shutdown handler so fatal paths can reuse the same flow.
 *
 * @param {http.Server[]} servers - Array of servers to close
 * @param {object} logger - pino logger instance
 * @param {NodeJS.Process} [processRef] - process-like object for testing
 * @returns {Function}
 */
module.exports.gracefulShutdown = (servers, logger, processRef = process) => {
  let shutdownPromise;

  const shutdown = ({
    exitCode = 0,
    reason = 'signal',
    signal,
  } = {}) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    let resolvedExitCode = exitCode;

    shutdownPromise = (async () => {
      try {
        logger.info({ exitCode, reason, signal }, 'Closing servers');

        if (servers.length > 0) {
          try {
            await module.exports.closeServers(servers);
            logger.info('All servers closed gracefully');
          } catch (err) {
            resolvedExitCode = 1;
            logger.error({ err }, 'Error during graceful shutdown');
          }
        } else {
          logger.info('No servers registered for shutdown');
        }
      } finally {
        processRef.exit(resolvedExitCode);
      }
    })();

    return shutdownPromise;
  };

  processRef.on('SIGTERM', () => {
    shutdown({ exitCode: 0, reason: 'signal', signal: 'SIGTERM' });
  });
  processRef.on('SIGINT', () => {
    shutdown({ exitCode: 0, reason: 'signal', signal: 'SIGINT' });
  });

  return shutdown;
};
