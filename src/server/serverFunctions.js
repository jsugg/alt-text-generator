const http = require('http');
const https = require('https');

module.exports.createHttpServer = (app) => http.createServer(app);

/**
 * Creates an HTTPS server.
 * readCertFile defaults to reading TLS_KEY / TLS_CERT env vars directly,
 * which works in production environments that inject secrets via env vars.
 *
 * @param {object} app - Express application
 * @param {function} [readCertFile] - Cert loader; defaults to env-var reader
 * @returns {https.Server}
 */
module.exports.createHttpsServer = (app, readCertFile = () => ({
  key: process.env.TLS_KEY,
  cert: process.env.TLS_CERT,
})) => {
  const { key, cert } = readCertFile();
  return https.createServer({ key, cert }, app);
};

module.exports.startServer = (server, port, logger) => {
  server.listen(port, () => {
    logger.logger.info({ port }, 'Server listening');
  });
};

/**
 * Registers SIGTERM / SIGINT handlers that close all servers gracefully.
 * Additional cleanup (e.g. DB connections) can be done before calling this.
 *
 * @param {http.Server[]} servers - Array of servers to close
 * @param {object} logger - pino logger instance (appLogger)
 */
module.exports.gracefulShutdown = (servers, logger) => {
  const shutdown = async () => {
    logger.logger.info('Shutdown signal received, closing servers...');
    try {
      await Promise.all(
        servers.map((server) => new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        })),
      );
      logger.logger.info('All servers closed gracefully');
    } catch (err) {
      logger.logger.error({ err }, 'Error during graceful shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};
