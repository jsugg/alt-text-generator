// dotenv must be loaded before any other module reads process.env
require('dotenv').config({
  path: process.env.ENV_FILE || '.env',
  override: Boolean(process.env.ENV_FILE),
});

const cluster = require('cluster');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Config & validation
const config = require('../config');
const serverConfig = require('../config/serverConfig');
const { validateEnvVars } = require('./utils/validateEnvVars');

validateEnvVars();

// Infrastructure
const { appLogger } = require('./infrastructure/logger');
const { loadTlsCredentials } = require('./infrastructure/loadTlsCredentials');
const { createApp } = require('./createApp');

// Server
const { setupCluster } = require('./server/clusterManager');
const { startWorkerServers } = require('./server/startWorkerServers');
const {
  createHttpServer,
  createHttpsServer,
  startServer,
  gracefulShutdown,
} = require('./server/serverFunctions');

const getAvailableWorkerCount = () => (
  typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length
);

const resolveWorkerCount = () => (
  config.cluster.workers
  ?? (config.env === 'production' ? getAvailableWorkerCount() : 1)
);

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

  const workerCount = resolveWorkerCount();
  appLogger.info({ workerCount, env: config.env }, 'Starting cluster');
  setupCluster(cluster, appLogger, workerCount);
} else {
  const startWorker = async () => {
    const { app } = createApp({ config, appLogger });

    await startWorkerServers({
      app,
      config,
      serverConfig,
      appLogger,
      loadTlsCredentials,
      createHttpServer,
      createHttpsServer,
      startServer,
      gracefulShutdown,
    });
  };

  startWorker().catch((error) => {
    appLogger.fatal({ error }, 'Worker startup failed');
    process.exit(1);
  });
}
