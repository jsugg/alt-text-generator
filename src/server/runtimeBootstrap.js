const fs = require('fs');
const path = require('path');

const DEFAULT_PID_FILE = path.resolve(__dirname, '../../alt-text-generator.pid');

/** @typedef {{ env?: string, cluster?: { workers?: number } }} BootstrapConfig */
/**
 * @typedef {{
 *   info: (details: object | string, message?: string) => void,
 *   fatal: (details: object | string, message?: string) => void,
 * }} BootstrapLogger
 */

/** @param {BootstrapConfig} config */
const resolveWorkerCount = (config) => config.cluster?.workers ?? 1;

/** @param {number} workerCount */
const shouldUseCluster = (workerCount) => (
  Number.isInteger(workerCount) && workerCount > 1
);

/**
 * @param {{
 *   cluster: { isPrimary?: boolean },
 *   fsModule?: { writeFileSync: (file: string, data: string) => void },
 *   pidFile?: string,
 *   processRef?: NodeJS.Process,
 * }} options
 */
const writePrimaryPidFile = ({
  cluster,
  fsModule = fs,
  pidFile = DEFAULT_PID_FILE,
  processRef = process,
}) => {
  if (!cluster.isPrimary) {
    return;
  }

  fsModule.writeFileSync(pidFile, processRef.pid.toString());
};

/**
 * Bootstraps the app in standalone or clustered mode.
 *
 * @param {object} params - bootstrap dependencies
 * @param {{ isPrimary?: boolean }} params.cluster - Node cluster module or test double
 * @param {BootstrapConfig} params.config - resolved runtime config
 * @param {BootstrapLogger} params.logger - pino logger
 * @param {NodeJS.Process} [params.processRef] - process-like object for tests
 * @param {Function} params.setupClusterFn - cluster setup function
 * @param {() => Promise<void> | void} params.startRuntimeFn - standalone/worker runtime starter
 * @param {{ writeFileSync: (file: string, data: string) => void }} [params.fsModule]
 *   injected fs module for tests
 * @param {string} [params.pidFile] - injected pid path for tests
 * @returns {Promise<void>}
 */
const startApplication = async ({
  cluster,
  config,
  fsModule = fs,
  logger,
  pidFile = DEFAULT_PID_FILE,
  processRef = process,
  setupClusterFn,
  startRuntimeFn,
}) => {
  const workerCount = resolveWorkerCount(config);

  writePrimaryPidFile({
    cluster,
    fsModule,
    pidFile,
    processRef,
  });

  if (shouldUseCluster(workerCount) && cluster.isPrimary) {
    logger.info({ workerCount, env: config.env }, 'Starting cluster runtime');
    setupClusterFn(cluster, logger, workerCount, config.cluster, processRef);
    return;
  }

  logger.info(
    { workerCount, env: config.env },
    shouldUseCluster(workerCount)
      ? 'Starting cluster worker runtime'
      : 'Starting single-process runtime',
  );

  try {
    await startRuntimeFn();
  } catch (error) {
    logger.fatal({ err: error }, 'Runtime bootstrap failed');
    processRef.exit(1);
  }
};

module.exports = {
  resolveWorkerCount,
  shouldUseCluster,
  startApplication,
  writePrimaryPidFile,
};
