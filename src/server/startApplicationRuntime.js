const serverConfig = require('../../config/serverConfig');
const { createApp } = require('../createApp');
const { loadTlsCredentials } = require('../infrastructure/loadTlsCredentials');
const {
  initializeDescriptionJobStore,
} = require('../infrastructure/descriptionJobStore');
const {
  initializeRateLimitStoreProvider,
} = require('../infrastructure/rateLimitStore');
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
 * All dependencies are injectable for tests; the loose `Function` types keep
 * the fakes assignable while the real defaults stay strongly typed at source.
 *
 * @param {{
 *   appLogger?: import('./registerFatalHandlers').FatalLogger,
 *   config?: object,
 *   processRef?: NodeJS.Process,
 *   createAppFn?: Function,
 *   createHttpServerFn?: Function,
 *   createHttpsServerFn?: Function,
 *   gracefulShutdownFn?: Function,
 *   initializeDescriptionJobStoreFn?: Function,
 *   initializeRateLimitStoreProviderFn?: Function,
 *   loadTlsCredentialsFn?: Function,
 *   serverPorts?: { httpPort?: number, httpsPort?: number, httpsEnabled?: boolean },
 *   startServerFn?: Function,
 * }} [params] - runtime dependencies
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
  initializeDescriptionJobStoreFn = initializeDescriptionJobStore,
  initializeRateLimitStoreProviderFn = initializeRateLimitStoreProvider,
  loadTlsCredentialsFn = loadTlsCredentials,
  serverPorts = serverConfig,
  startServerFn = startServer,
} = {}) => {
  /** @type {import('./registerFatalHandlers').ShutdownHandler | undefined} */
  let shutdown;
  /** @type {{ close?: () => Promise<void> | void } | undefined} */
  let descriptionJobStore;
  /** @type {{ close?: () => Promise<void> | void } | undefined} */
  let rateLimitStoreProvider;
  const cleanupFatalHandlers = registerFatalHandlers({
    getShutdownHandler: () => shutdown,
    logger: /** @type {import('./registerFatalHandlers').FatalLogger} */ (appLogger),
    processRef,
  });

  try {
    const runtimeState = createRuntimeState();
    descriptionJobStore = await initializeDescriptionJobStoreFn({
      config,
      logger: appLogger,
    });
    rateLimitStoreProvider = await initializeRateLimitStoreProviderFn({
      config,
      logger: appLogger,
    });
    const { app } = createAppFn({
      config,
      appLogger,
      descriptionJobStore,
      rateLimitStoreProvider,
      runtimeState,
    });
    // Skip the app's own TLS listener where TLS terminates at the platform edge
    // (httpsEnabled === false). This avoids loading certificates that do not
    // exist there and binds only the plain HTTP listener the platform probes.
    const httpsEnabled = serverPorts.httpsEnabled !== false;
    const httpServer = createHttpServerFn(app);
    /** @type {import('node:http').Server[]} */
    const servers = [httpServer];
    /** @type {import('node:http').Server | undefined} */
    let httpsServer;

    // Load certificates before binding any listener so a TLS failure aborts the
    // whole boot rather than leaving a half-open HTTP socket behind.
    if (httpsEnabled) {
      const tlsCredentials = await loadTlsCredentialsFn();
      const createdHttpsServer = createHttpsServerFn(app, () => tlsCredentials);
      httpsServer = createdHttpsServer;
      servers.push(createdHttpsServer);
    }

    /** @type {Array<Promise<unknown>>} */
    const listeners = [startServerFn(httpServer, serverPorts.httpPort, appLogger)];
    if (httpsServer) {
      listeners.push(startServerFn(httpsServer, serverPorts.httpsPort, appLogger));
    }

    await Promise.all(listeners);
    runtimeState.markReady();

    shutdown = gracefulShutdownFn(
      servers,
      appLogger,
      runtimeState,
      processRef,
      [
        () => descriptionJobStore?.close?.(),
        () => rateLimitStoreProvider?.close?.(),
      ],
    );

    return {
      cleanupFatalHandlers,
      descriptionJobStore,
      rateLimitStoreProvider,
      runtimeState,
      servers,
      shutdown,
    };
  } catch (error) {
    cleanupFatalHandlers();
    try {
      await descriptionJobStore?.close?.();
    } catch (closeError) {
      appLogger?.error?.({ err: closeError }, 'Failed to close description-job store during bootstrap cleanup');
    }
    try {
      await rateLimitStoreProvider?.close?.();
    } catch (closeError) {
      appLogger?.error?.({ err: closeError }, 'Failed to close rate-limit store during bootstrap cleanup');
    }
    throw error;
  }
};

module.exports = { startApplicationRuntime };
