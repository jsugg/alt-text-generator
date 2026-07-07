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
 *   serverPorts?: { httpPort?: number, httpsPort?: number },
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
    const tlsCredentials = await loadTlsCredentialsFn();
    const httpServer = createHttpServerFn(app);
    const httpsServer = createHttpsServerFn(app, () => tlsCredentials);

    await Promise.all([
      startServerFn(httpServer, serverPorts.httpPort, appLogger),
      startServerFn(httpsServer, serverPorts.httpsPort, appLogger),
    ]);
    runtimeState.markReady();

    shutdown = gracefulShutdownFn(
      [httpServer, httpsServer],
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
      servers: [httpServer, httpsServer],
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
