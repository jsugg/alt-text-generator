/**
 * Configures and starts Node.js cluster workers.
 *
 * Forks the requested number of workers, reforks only on unexpected exits, and
 * applies bounded restart policy controls to avoid tight crash loops.
 *
 * @param {object} cluster - Node.js cluster module
 * @param {object} logger - pino logger instance (appLogger)
 * @param {number} workerCount - number of workers to fork
 * @param {object} [clusterConfig] - cluster lifecycle config
 * @param {NodeJS.Process} [processRef] - process-like object for tests
 */
const DEFAULT_CLUSTER_POLICY = Object.freeze({
  crashWindowMs: 60000,
  maxCrashCount: 5,
  maxRestartBackoffMs: 30000,
  restartBackoffMs: 1000,
  shutdownTimeoutMs: 10000,
});

const resolveClusterPolicy = (clusterConfig = {}) => ({
  ...DEFAULT_CLUSTER_POLICY,
  crashWindowMs: clusterConfig.crashWindowMs ?? DEFAULT_CLUSTER_POLICY.crashWindowMs,
  maxCrashCount: clusterConfig.maxCrashCount ?? DEFAULT_CLUSTER_POLICY.maxCrashCount,
  maxRestartBackoffMs:
    clusterConfig.maxRestartBackoffMs ?? DEFAULT_CLUSTER_POLICY.maxRestartBackoffMs,
  restartBackoffMs: clusterConfig.restartBackoffMs ?? DEFAULT_CLUSTER_POLICY.restartBackoffMs,
  shutdownTimeoutMs: clusterConfig.shutdownTimeoutMs ?? DEFAULT_CLUSTER_POLICY.shutdownTimeoutMs,
});

const calculateRestartDelay = ({
  maxRestartBackoffMs,
  restartBackoffMs,
  unexpectedExitCount,
}) => Math.min(
  restartBackoffMs * (2 ** Math.max(unexpectedExitCount - 1, 0)),
  maxRestartBackoffMs,
);

const setupCluster = (
  cluster,
  logger,
  workerCount,
  clusterConfig = {},
  processRef = process,
) => {
  const safeWorkerCount = Number.isInteger(workerCount) && workerCount > 0
    ? workerCount
    : 1;
  const clusterPolicy = resolveClusterPolicy(clusterConfig);
  const pendingRestarts = new Set();
  const recentUnexpectedExits = [];
  let shutdownTimer;
  let shuttingDown = false;

  const clearPendingRestarts = () => {
    pendingRestarts.forEach(clearTimeout);
    pendingRestarts.clear();
  };

  const exitPrimary = (exitCode) => {
    processRef.exit(exitCode);
  };

  const shutdownPrimary = ({ exitCode, signal }) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearPendingRestarts();
    logger.info({ exitCode, signal }, 'Primary shutting down cluster');

    shutdownTimer = setTimeout(() => {
      logger.error(
        { exitCode, signal, shutdownTimeoutMs: clusterPolicy.shutdownTimeoutMs },
        'Cluster shutdown timed out, forcing exit',
      );
      exitPrimary(exitCode);
    }, clusterPolicy.shutdownTimeoutMs);

    if (typeof cluster.disconnect === 'function') {
      cluster.disconnect(() => {
        clearTimeout(shutdownTimer);
        exitPrimary(exitCode);
      });
      return;
    }

    clearTimeout(shutdownTimer);
    exitPrimary(exitCode);
  };

  cluster.setupPrimary();

  for (let i = 0; i < safeWorkerCount; i += 1) {
    cluster.fork();
  }

  processRef.on('SIGTERM', () => {
    shutdownPrimary({ exitCode: 0, signal: 'SIGTERM' });
  });
  processRef.on('SIGINT', () => {
    shutdownPrimary({ exitCode: 0, signal: 'SIGINT' });
  });

  cluster.on('exit', (worker, code, signal) => {
    const pid = worker.process?.pid;
    const intentional = shuttingDown || worker.exitedAfterDisconnect === true;

    if (intentional) {
      logger.info({ pid, code, signal }, 'Worker exited intentionally');
      return;
    }

    const now = Date.now();
    const earliestRetainedCrash = now - clusterPolicy.crashWindowMs;
    recentUnexpectedExits.push(now);

    while (
      recentUnexpectedExits.length > 0
      && recentUnexpectedExits[0] < earliestRetainedCrash
    ) {
      recentUnexpectedExits.shift();
    }

    const unexpectedExitCount = recentUnexpectedExits.length;
    if (unexpectedExitCount > clusterPolicy.maxCrashCount) {
      logger.fatal(
        {
          code,
          crashWindowMs: clusterPolicy.crashWindowMs,
          maxCrashCount: clusterPolicy.maxCrashCount,
          pid,
          signal,
          unexpectedExitCount,
        },
        'Cluster crash budget exhausted',
      );
      shutdownPrimary({ exitCode: 1, signal: 'crash-budget-exhausted' });
      return;
    }

    const restartDelayMs = calculateRestartDelay({
      maxRestartBackoffMs: clusterPolicy.maxRestartBackoffMs,
      restartBackoffMs: clusterPolicy.restartBackoffMs,
      unexpectedExitCount,
    });

    logger.warn({
      code,
      pid,
      restartDelayMs,
      signal,
      unexpectedExitCount,
    }, 'Worker died unexpectedly, scheduling restart');

    const restartTimer = setTimeout(() => {
      pendingRestarts.delete(restartTimer);

      if (!shuttingDown) {
        cluster.fork();
      }
    }, restartDelayMs);

    pendingRestarts.add(restartTimer);
  });

  return {
    shutdownPrimary,
  };
};

module.exports = {
  calculateRestartDelay,
  resolveClusterPolicy,
  setupCluster,
};
