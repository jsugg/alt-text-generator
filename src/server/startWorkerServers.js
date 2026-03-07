const shouldStartHttps = (config) => (
  config.env !== 'production'
  || Boolean(config.https.keyPath && config.https.certPath)
);

const startWorkerServers = async ({
  app,
  config,
  serverConfig,
  appLogger,
  loadTlsCredentials,
  createHttpServer,
  createHttpsServer,
  startServer,
  gracefulShutdown,
}) => {
  const httpServer = createHttpServer(app);
  const servers = [httpServer];

  startServer(httpServer, serverConfig.httpPort, appLogger);

  if (shouldStartHttps(config)) {
    const tlsCredentials = await loadTlsCredentials();
    const httpsServer = createHttpsServer(app, () => tlsCredentials);

    startServer(httpsServer, serverConfig.httpsPort, appLogger);
    servers.push(httpsServer);
  } else {
    appLogger.info(
      {
        env: config.env,
        httpPort: serverConfig.httpPort,
        httpsPort: serverConfig.httpsPort,
      },
      'HTTPS listener disabled because TLS credentials are not configured',
    );
  }

  gracefulShutdown(servers, appLogger);

  return servers;
};

module.exports = {
  shouldStartHttps,
  startWorkerServers,
};
