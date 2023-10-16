/**
 * @file Main server entry point
 * @author Juan Sugg
 * @version 1.0
 */

// Node Modules
const cluster = require('cluster');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Third-party Modules
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const Joi = require('joi');

// Custom Modules
const { appLogger, serverLogger } = require('./utils/logger');
const { loadRequestFilter } = require('./api/v1/middleware/request-filter')(
  serverLogger,
);
const { apiRouter, loadAPIRoutes } = require('./api/v1/routes/api')(
  serverLogger,
);
const swaggerSpec = require('../config/swagger');

// Set log level
serverLogger.logger.level = 'trace';
appLogger.level = 'trace';

// Validate Environment Variables
const envVarsSchema = Joi.object({
  PORT: Joi.number().required(),
  TLS_PORT: Joi.number().required(),
})
  .unknown()
  .required();

const { error: envVarsError } = envVarsSchema.validate(process.env);
if (envVarsError) {
  serverLogger.logger.error(`Config validation error: ${envVarsError.message}`);
  process.exit(1);
}

// Initialize Express App
const app = express();

// Security Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        upgradeInsecureRequests: [],
      },
    },
  }),
);
app.use(cors());

// Logger and Rate Limiter
app.use(serverLogger);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.',
  }),
);

// API Routes
const appRouter = express.Router();
loadRequestFilter(serverLogger, appRouter);
loadAPIRoutes(serverLogger);
appRouter.use('/api', apiRouter);

// Swagger Documentation
const swaggerRouter = express.Router();
swaggerRouter.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Main Router
appRouter.use((req, res, next) => {
  if (req.path.startsWith('/api-docs')) {
    swaggerRouter(req, res, next);
  } else if (req.path.startsWith('/api')) {
    apiRouter(req, res, next);
  } else {
    next();
  }
});

app.use(appRouter);

const { logger } = serverLogger;

/**
 * Reads a certificate from either an environment variable or a default file path.
 *
 * @param {String} envVar - The environment variable containing the certificate (base64 encoded).
 * @param {String} defaultPath - The default file path to read the certificate
 * from if the environment variable is not set.
 * @return {String|Buffer} The certificate content as a string if the environment variable
 * is set, or as a Buffer if read from the default file path.
 */
const readCert = (envVar, defaultPath) => (
  envVar
    ? Buffer.from(envVar, 'base64').toString('ascii')
    : fs.readFileSync(path.join(__dirname, defaultPath)));

/**
 * Starts the server on the specified port.
 *
 * @param {object} server - The server object to start.
 * @param {number} port - The port number to listen on.
 * @return {Promise} A promise that resolves when the server starts listening.
 */
const startServer = (server, port) => new Promise((resolve) => {
  server.listen(port, '0.0.0.0', () => {
    logger.info(`Server listening on port ${port}`);
    resolve();
  });
});

/**
 * Initializes the server by creating HTTP and HTTPS servers and starting them
 * on the specified ports. It also sets up a graceful shutdown mechanism to
 * close the servers and terminate the process when a termination signal is
 * received.
 *
 * @return {void}
 */
const initServer = async () => {
  logger.info('Starting server...');

  const isProduction = process.env.NODE_ENV === 'production';
  const httpPort = process.env.PORT || (isProduction ? 80 : 8080);
  const httpsPort = process.env.TLS_PORT || (isProduction ? 443 : 4443);

  const httpServer = http.createServer(app);
  const httpsServer = https.createServer(
    {
      key: readCert(process.env.TLS_KEY, '../certs/localhost-key.pem'),
      cert: readCert(process.env.TLS_CERT, '../certs/localhost.pem'),
    },
    app,
  );

  /**
   * Shuts down the server gracefully by closing the HTTP and HTTPS servers
   * and then exiting the process.
   *
   * @param {function} callback - The callback function to be executed after
   * the servers have been closed.
   * @return {void}
   */
  const shutdown = () => {
    httpServer.close(() => {
      httpsServer.close(() => {
        process.exit(0);
      });
    });
  };

  ['SIGTERM', 'SIGINT'].forEach((signal) => process.on(signal, shutdown));

  const startServers = isProduction
    ? [[startServer(httpServer, httpPort)]]
    : [startServer(httpServer, httpPort), startServer(httpsServer, httpsPort)];

  await Promise.all(startServers);

  logger.info('Server started.');
};

// Cluster Mode Initialization
if (cluster.isMaster) {
  const numCPUs = os.cpus().length;
  cluster.setupMaster();
  for (let i = 0; i < numCPUs; i += 1) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    serverLogger.logger.info(
      `Worker ${worker.process.pid} died, code: ${code}, signal: ${signal}`,
    );
    cluster.disconnect();
  });
  cluster.on('message', (worker, message) => {
    serverLogger.logger.info(
      `Message from worker ${worker.process.pid}: ${message}`,
    );
  });
} else {
  initServer().catch((err) => {
    serverLogger.logger.error(`Server Initialization Error: ${err.message}`);
    process.exit(1);
  });
}
