const http = require('http');
const https = require('https');

const DEFAULT_HEADERS_TIMEOUT_MS = 60_000;
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const FORCE_SOCKET_CLOSE_TIMEOUT_MS = 1_000;
const TRACKED_SOCKETS = Symbol('trackedSockets');

const trackSocket = (sockets, socket) => {
  sockets.add(socket);
  socket.on('close', () => {
    sockets.delete(socket);
  });
};

const configureServer = (server) => {
  const trackedSockets = new Set();
  server.on('connection', (socket) => trackSocket(trackedSockets, socket));

  return Object.assign(server, {
    [TRACKED_SOCKETS]: trackedSockets,
    headersTimeout: DEFAULT_HEADERS_TIMEOUT_MS,
    keepAliveTimeout: DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
    requestTimeout: DEFAULT_REQUEST_TIMEOUT_MS,
  });
};

const forceCloseServerConnections = (server) => {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }

  const sockets = server[TRACKED_SOCKETS] ?? new Set();
  sockets.forEach((socket) => {
    socket.destroy();
  });
};

const normalizeCleanupTasks = (cleanupTasks) => (
  (Array.isArray(cleanupTasks) ? cleanupTasks : [cleanupTasks])
    .filter((cleanupTask) => typeof cleanupTask === 'function')
);

module.exports.createHttpServer = (app) => configureServer(http.createServer(app));

/**
 * Creates an HTTPS server.
 * A credentials loader can provide PEM strings or Buffers.
 *
 * @param {object} app - Express application
 * @param {function} [loadTlsCredentials] - TLS credential loader
 * @returns {https.Server}
 */
module.exports.createHttpsServer = (app, loadTlsCredentials = () => ({
  key: process.env.TLS_KEY,
  cert: process.env.TLS_CERT,
})) => {
  const { key, cert } = loadTlsCredentials();
  return configureServer(https.createServer({ key, cert }, app));
};

module.exports.startServer = (server, port, logger) => {
  if (server.listening) {
    return Promise.resolve(server);
  }

  return new Promise((resolve, reject) => {
    let handleListening = () => {};

    const handleError = (error) => {
      server.off('listening', handleListening);
      reject(error);
    };

    handleListening = () => {
      server.off('error', handleError);
      logger.info({ port }, 'Server listening');
      resolve(server);
    };

    server.once('error', handleError);
    server.once('listening', handleListening);

    try {
      server.listen(port);
    } catch (error) {
      server.off('error', handleError);
      server.off('listening', handleListening);
      reject(error);
    }
  });
};

module.exports.closeServers = async (servers) => {
  await Promise.all(
    servers.map((server) => new Promise((resolve, reject) => {
      const forceCloseTimer = setTimeout(() => {
        forceCloseServerConnections(server);
      }, FORCE_SOCKET_CLOSE_TIMEOUT_MS);

      if (typeof forceCloseTimer.unref === 'function') {
        forceCloseTimer.unref();
      }

      server.close((err) => {
        clearTimeout(forceCloseTimer);
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });

      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
    })),
  );
};

/**
 * Registers SIGTERM / SIGINT handlers that close all servers gracefully.
 * Returns the shared shutdown handler so fatal paths can reuse the same flow.
 *
 * @param {http.Server[]} servers - Array of servers to close
 * @param {object} logger - pino logger instance
 * @param {NodeJS.Process} [processRef] - process-like object for testing
 * @param {object} [runtimeState] - mutable runtime readiness state
 * @param {Function[]|Function} [cleanupTasks] - async cleanup callbacks
 * @returns {Function}
 */
module.exports.gracefulShutdown = (
  servers,
  logger,
  runtimeState,
  processRef,
  cleanupTasks = [],
) => {
  const resolvedProcessRef = processRef ?? process;
  const resolvedCleanupTasks = normalizeCleanupTasks(cleanupTasks);
  let shutdownPromise;

  const shutdown = ({
    exitCode = 0,
    reason = 'signal',
    signal,
  } = {}) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    let resolvedExitCode = exitCode;

    shutdownPromise = (async () => {
      try {
        runtimeState?.markDraining?.();
        logger.info({ exitCode, reason, signal }, 'Closing servers');

        if (servers.length > 0) {
          try {
            await module.exports.closeServers(servers);
            logger.info('All servers closed gracefully');
          } catch (err) {
            resolvedExitCode = 1;
            logger.error({ err }, 'Error during graceful shutdown');
          }
        } else {
          logger.info('No servers registered for shutdown');
        }
      } finally {
        await Promise.all(
          resolvedCleanupTasks.map(async (cleanupTask) => {
            try {
              await cleanupTask();
            } catch (error) {
              resolvedExitCode = 1;
              logger.error({ err: error }, 'Error during shutdown cleanup');
            }
          }),
        );
        resolvedProcessRef.exit(resolvedExitCode);
      }
    })();

    return shutdownPromise;
  };

  resolvedProcessRef.on('SIGTERM', () => {
    shutdown({ exitCode: 0, reason: 'signal', signal: 'SIGTERM' });
  });
  resolvedProcessRef.on('SIGINT', () => {
    shutdown({ exitCode: 0, reason: 'signal', signal: 'SIGINT' });
  });

  return shutdown;
};
