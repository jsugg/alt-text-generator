// dotenv must be loaded before any other module reads process.env
require('dotenv').config({
  path: process.env.ENV_FILE || '.env',
  override: Boolean(process.env.ENV_FILE),
});

const cluster = require('cluster');

// Config & validation
const config = require('../config');
const { appLogger } = require('./infrastructure/logger');
const { validateEnvVars } = require('./utils/validateEnvVars');

validateEnvVars({ logger: appLogger });

// Server
const { setupCluster } = require('./server/clusterManager');
const { startApplicationRuntime } = require('./server/startApplicationRuntime');
const { startApplication } = require('./server/runtimeBootstrap');

startApplication({
  cluster,
  config,
  logger: appLogger,
  setupClusterFn: setupCluster,
  startRuntimeFn: () => startApplicationRuntime({
    appLogger,
    config,
  }),
}).catch((error) => {
  appLogger.fatal({ err: error }, 'Application bootstrap failed');
  process.exit(1);
});
