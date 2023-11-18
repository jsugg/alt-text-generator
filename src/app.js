// Node Modules
const cluster = require('cluster');
const os = require('os');
const express = require('express');

// Configuration and Utilities
const { serverLogger } = require('./utils/logger');
const { createLogger } = require('./utils/createLogger');
const serverConfig = require('../config/serverConfig');
const { validateEnvVars } = require('./utils/validateEnvVars');
const { readCertFile } = require('./utils/readCertFile');
const { applyMiddlewares } = require('./utils/applyBaseMiddleware');
const { loadRequestFilter } = require('./api/v1/middleware/request-filter')(serverLogger);
const { createRouter } = require('./utils/createRouter');
const {
  createHttpServer,
  createHttpsServer,
  startServer,
  gracefulShutdown,
} = require('./server/serverFunctions');

// Initialize and configure logger
const logger = createLogger();

// Validate Environment Variables
validateEnvVars();

// Initialize Express App and apply middlewares
const app = express();
applyMiddlewares(app);
loadRequestFilter(serverLogger, app);

// Setup Routers
const appRouter = createRouter(serverLogger);
app.use(appRouter);

// Cluster Mode Initialization
if (cluster.isMaster) {
  serverConfig.setupCluster(cluster, os, logger);
} else {
  // Server initialization
  const httpServer = createHttpServer(app);
  const httpsServer = createHttpsServer(app, readCertFile);

  startServer(httpServer, serverConfig.httpPort, logger);
  startServer(httpsServer, serverConfig.httpsPort, logger);

  gracefulShutdown(httpServer, httpsServer, logger);
}
