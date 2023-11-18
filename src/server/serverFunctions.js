// server/serverFunctions.js
const http = require('http');
const https = require('https');

module.exports.createHttpServer = (app) => (
  http.createServer(app)
);

module.exports.createHttpsServer = (app, readCertFile) => {
  const { key, cert } = readCertFile();
  return https.createServer({ key, cert }, app);
};

module.exports.startServer = (server, port, logger) => {
  server.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });
};

module.exports.gracefulShutdown = (httpServer, httpsServer, logger) => {
  const shutdown = () => {
    httpServer.close(() => {
      httpsServer.close(() => {
        logger.info('Servers shut down gracefully.');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};
