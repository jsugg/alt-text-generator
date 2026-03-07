const {
  shouldStartHttps,
  startWorkerServers,
} = require('../../../src/server/startWorkerServers');

describe('shouldStartHttps', () => {
  it('keeps HTTPS enabled outside production even without explicit credentials', () => {
    expect(shouldStartHttps({
      env: 'development',
      https: {
        keyPath: undefined,
        certPath: undefined,
      },
    })).toBe(true);
  });

  it('disables HTTPS in production when TLS credentials are missing', () => {
    expect(shouldStartHttps({
      env: 'production',
      https: {
        keyPath: undefined,
        certPath: undefined,
      },
    })).toBe(false);
  });

  it('enables HTTPS in production when TLS credentials are configured', () => {
    expect(shouldStartHttps({
      env: 'production',
      https: {
        keyPath: '/tmp/tls.key',
        certPath: '/tmp/tls.cert',
      },
    })).toBe(true);
  });
});

describe('startWorkerServers', () => {
  const app = { name: 'app' };
  const serverConfig = {
    httpPort: 8080,
    httpsPort: 8443,
  };

  const buildDeps = () => ({
    appLogger: {
      info: jest.fn(),
      error: jest.fn(),
    },
    loadTlsCredentials: jest.fn().mockResolvedValue({
      key: 'tls-key',
      cert: 'tls-cert',
    }),
    createHttpServer: jest.fn().mockReturnValue({ name: 'http-server' }),
    createHttpsServer: jest.fn().mockReturnValue({ name: 'https-server' }),
    startServer: jest.fn(),
    gracefulShutdown: jest.fn(),
  });

  it('starts only the HTTP server in production when TLS credentials are absent', async () => {
    const deps = buildDeps();
    const config = {
      env: 'production',
      https: {
        keyPath: undefined,
        certPath: undefined,
      },
    };

    const servers = await startWorkerServers({
      app,
      config,
      serverConfig,
      ...deps,
    });

    expect(servers).toEqual([{ name: 'http-server' }]);
    expect(deps.startServer).toHaveBeenCalledTimes(1);
    expect(deps.startServer).toHaveBeenCalledWith(
      { name: 'http-server' },
      serverConfig.httpPort,
      deps.appLogger,
    );
    expect(deps.loadTlsCredentials).not.toHaveBeenCalled();
    expect(deps.createHttpsServer).not.toHaveBeenCalled();
    expect(deps.gracefulShutdown).toHaveBeenCalledWith(
      [{ name: 'http-server' }],
      deps.appLogger,
    );
    expect(deps.appLogger.info).toHaveBeenCalledWith(
      {
        env: 'production',
        httpPort: serverConfig.httpPort,
        httpsPort: serverConfig.httpsPort,
      },
      'HTTPS listener disabled because TLS credentials are not configured',
    );
  });

  it('starts both HTTP and HTTPS servers when production TLS credentials are configured', async () => {
    const deps = buildDeps();
    const config = {
      env: 'production',
      https: {
        keyPath: '/tmp/tls.key',
        certPath: '/tmp/tls.cert',
      },
    };

    const servers = await startWorkerServers({
      app,
      config,
      serverConfig,
      ...deps,
    });

    expect(servers).toEqual([
      { name: 'http-server' },
      { name: 'https-server' },
    ]);
    expect(deps.loadTlsCredentials).toHaveBeenCalledTimes(1);
    expect(deps.createHttpsServer).toHaveBeenCalledTimes(1);
    expect(deps.createHttpsServer).toHaveBeenCalledWith(
      app,
      expect.any(Function),
    );
    expect(deps.createHttpsServer.mock.calls[0][1]()).toEqual({
      key: 'tls-key',
      cert: 'tls-cert',
    });
    expect(deps.startServer).toHaveBeenNthCalledWith(
      1,
      { name: 'http-server' },
      serverConfig.httpPort,
      deps.appLogger,
    );
    expect(deps.startServer).toHaveBeenNthCalledWith(
      2,
      { name: 'https-server' },
      serverConfig.httpsPort,
      deps.appLogger,
    );
    expect(deps.gracefulShutdown).toHaveBeenCalledWith(
      [{ name: 'http-server' }, { name: 'https-server' }],
      deps.appLogger,
    );
  });
});
