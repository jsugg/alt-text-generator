// dotenv must be loaded before any other module reads process.env
require('dotenv').config();

const cluster = require('cluster');
const os = require('os');
const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const Replicate = require('replicate');

// Config & validation
const config = require('../config');
const { validateEnvVars } = require('./utils/validateEnvVars');

validateEnvVars();

// Infrastructure
const { appLogger, serverLogger } = require('./infrastructure/logger');
const { readCertFile } = require('./infrastructure/readCertFile');

// Services
const ScraperService = require('./services/ScraperService');
const ReplicateDescriberService = require('./services/ReplicateDescriberService');
const ImageDescriberFactory = require('./services/ImageDescriberFactory');

// Controllers
const healthController = require('./api/v1/controllers/healthController');
const ScraperController = require('./api/v1/controllers/scraperController');
const DescriptionController = require('./api/v1/controllers/descriptionController');

// Middleware & routing
const { applyMiddlewares } = require('./utils/applyBaseMiddleware');
const { loadRequestFilter } = require('./api/v1/middleware/request-filter')(serverLogger);
const { createRouter } = require('./utils/createRouter');
const buildApiRouter = require('./api/v1/routes/api');

// Server
const serverConfig = require('../config/serverConfig');
const { setupCluster } = require('./server/clusterManager');
const {
  createHttpServer,
  createHttpsServer,
  startServer,
  gracefulShutdown,
} = require('./server/serverFunctions');

// Global error handlers — registered before any async work
process.on('uncaughtException', (error) => {
  appLogger.fatal({ error }, 'Uncaught exception — shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  appLogger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
  process.exit(1);
});

if (cluster.isPrimary) {
  // Write PID file from the primary process only
  const pidFile = path.resolve(__dirname, '../alt-text-generator.pid');
  fs.writeFileSync(pidFile, process.pid.toString());

  setupCluster(cluster, os, appLogger);
} else {
  // --- Worker: wire up the full application ---

  // Services
  const scraperService = new ScraperService({ logger: appLogger, httpClient: axios });

  const replicateClient = new Replicate({
    auth: config.replicate.apiToken,
    baseUrl: config.replicate.apiEndpoint,
    userAgent: config.replicate.userAgent,
  });
  const replicateDescriber = new ReplicateDescriberService({
    logger: appLogger,
    replicateClient,
    config,
  });

  // Register AI providers — add new providers here without modifying other files
  const imageDescriberFactory = new ImageDescriberFactory()
    .register('clip', replicateDescriber);

  // Controllers
  const scraperController = new ScraperController({
    scraperService,
    logger: appLogger,
  });
  const descriptionController = new DescriptionController({
    imageDescriberFactory,
    logger: appLogger,
  });

  // Express app
  const app = express();
  applyMiddlewares(app);
  loadRequestFilter(app);

  const apiRouter = buildApiRouter(
    { health: healthController, scraper: scraperController, description: descriptionController },
    serverLogger,
  );
  const mainRouter = createRouter(serverLogger, apiRouter);
  app.use(mainRouter);

  // Servers
  const httpServer = createHttpServer(app);
  const httpsArgs = config.env === 'production' ? [app, readCertFile] : [app];
  const httpsServer = createHttpsServer(...httpsArgs);

  startServer(httpServer, serverConfig.httpPort, serverLogger);
  startServer(httpsServer, serverConfig.httpsPort, serverLogger);

  gracefulShutdown([httpServer, httpsServer], serverLogger);
}
