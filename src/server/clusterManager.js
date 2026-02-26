/**
 * Configures and starts Node.js cluster workers.
 *
 * Forks one worker per CPU. Restarts workers that die unexpectedly.
 *
 * @param {object} cluster - Node.js cluster module
 * @param {object} os - Node.js os module
 * @param {object} logger - pino logger instance (appLogger)
 */
const setupCluster = (cluster, os, logger) => {
  const numCPUs = os.cpus().length;
  cluster.setupPrimary();

  for (let i = 0; i < numCPUs; i += 1) {
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
