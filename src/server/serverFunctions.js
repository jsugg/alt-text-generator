require('dotenv').config();
const http = require('http');
const https = require('https');

module.exports.createHttpServer = (app) => (
  http.createServer(app)
);

module.exports.createHttpsServer = (app, readCertFile = () => {
  const key = process.env.TLS_KEY;
  const cert = process.env.TLS_CERT;
  return { key, cert };
}) => {
  const { key, cert } = readCertFile();
  return https.createServer({ key, cert }, app);
};

module.exports.startServer = (server, port, logger) => {
  server.listen(port, () => {
    logger.logger.info(`Server listening on port ${port}`);
  });
};

module.exports.gracefulShutdown = (httpServer, httpsServer, logger) => {
  const shutdown = () => {
    httpServer.close(() => {
      httpsServer.close(() => {
        logger.logger.info('Servers shut down gracefully.');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};
