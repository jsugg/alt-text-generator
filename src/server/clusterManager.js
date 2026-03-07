/**
 * Configures and starts Node.js cluster workers.
 *
 * Forks the requested number of workers and restarts workers that die unexpectedly.
 *
 * @param {object} cluster - Node.js cluster module
 * @param {object} logger - pino logger instance (appLogger)
 * @param {number} workerCount - number of workers to fork
 */
const setupCluster = (cluster, logger, workerCount) => {
  const safeWorkerCount = Number.isInteger(workerCount) && workerCount > 0
    ? workerCount
    : 1;

  cluster.setupPrimary();

  for (let i = 0; i < safeWorkerCount; i += 1) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.info(
      { pid: worker.process.pid, code, signal },
      'Worker died, restarting',
    );
    cluster.fork();
  });
};

module.exports = { setupCluster };
