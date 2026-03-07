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

/**
 * Registers SIGTERM / SIGINT handlers that close all servers gracefully.
 * Additional cleanup (e.g. DB connections) can be done before calling this.
 *
 * @param {http.Server[]} servers - Array of servers to close
 * @param {object} logger - pino logger instance
 */
module.exports.gracefulShutdown = (servers, logger) => {
  const shutdown = async () => {
    logger.info('Shutdown signal received, closing servers...');
    try {
      await Promise.all(
        servers.map((server) => new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        })),
      );
      logger.info('All servers closed gracefully');
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};
