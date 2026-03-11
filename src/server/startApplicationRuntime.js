const serverConfig = require('../../config/serverConfig');
const { createApp } = require('../createApp');
const { loadTlsCredentials } = require('../infrastructure/loadTlsCredentials');
const { registerFatalHandlers } = require('./registerFatalHandlers');
const { createRuntimeState } = require('./runtimeState');
const {
  createHttpServer,
  createHttpsServer,
  startServer,
  gracefulShutdown,
} = require('./serverFunctions');

/**
 * Starts the HTTP/HTTPS application runtime in the current process.
 *
 * @param {object} params - runtime dependencies
 * @param {object} params.appLogger - pino logger
 * @param {object} params.config - resolved runtime config
 * @param {object} [params.processRef] - process-like object for tests
 * @param {Function} [params.createAppFn] - injected createApp implementation
 * @param {Function} [params.createHttpServerFn] - injected HTTP server factory
 * @param {Function} [params.createHttpsServerFn] - injected HTTPS server factory
 * @param {Function} [params.gracefulShutdownFn] - injected shutdown registrar
 * @param {Function} [params.loadTlsCredentialsFn] - injected TLS loader
 * @param {object} [params.serverPorts] - injected server ports for tests
 * @param {Function} [params.startServerFn] - injected listen helper
 * @returns {Promise<object>}
 */
const startApplicationRuntime = async ({
  appLogger,
  config,
  processRef = process,
  createAppFn = createApp,
  createHttpServerFn = createHttpServer,
  createHttpsServerFn = createHttpsServer,
  gracefulShutdownFn = gracefulShutdown,
  loadTlsCredentialsFn = loadTlsCredentials,
  serverPorts = serverConfig,
  startServerFn = startServer,
} = {}) => {
  let shutdown;
  const cleanupFatalHandlers = registerFatalHandlers({
    getShutdownHandler: () => shutdown,
    logger: appLogger,
    processRef,
  });

  try {
    const runtimeState = createRuntimeState();
    const { app } = createAppFn({ config, appLogger, runtimeState });
    const tlsCredentials = await loadTlsCredentialsFn();
    const httpServer = createHttpServerFn(app);
    const httpsServer = createHttpsServerFn(app, () => tlsCredentials);

    await Promise.all([
      startServerFn(httpServer, serverPorts.httpPort, appLogger),
      startServerFn(httpsServer, serverPorts.httpsPort, appLogger),
    ]);
    runtimeState.markReady();

    shutdown = gracefulShutdownFn([httpServer, httpsServer], appLogger, runtimeState, processRef);

    return {
      cleanupFatalHandlers,
      runtimeState,
      servers: [httpServer, httpsServer],
      shutdown,
    };
  } catch (error) {
    cleanupFatalHandlers();
    throw error;
  }
};

module.exports = { startApplicationRuntime };
