const { EventEmitter } = require('events');

const { startApplicationRuntime } = require('../../../src/server/startApplicationRuntime');

const createProcessRef = () => {
  const processRef = new EventEmitter();
  processRef.exit = jest.fn();
  return processRef;
};

describe('Unit | Server | Start Application Runtime', () => {
  it('starts both servers and registers graceful shutdown', async () => {
    const app = { name: 'express-app' };
    const httpServer = { kind: 'http' };
    const httpsServer = { kind: 'https' };
    const shutdown = jest.fn();
    const descriptionJobStore = {
      close: jest.fn(),
    };
    const rateLimitStoreProvider = {
      close: jest.fn(),
      createStore: jest.fn(),
      kind: 'memory',
    };
    const createAppFn = jest.fn(() => ({ app }));
    const gracefulShutdownFn = jest.fn(() => shutdown);
    const initializeDescriptionJobStoreFn = jest.fn(() => descriptionJobStore);
    const initializeRateLimitStoreProviderFn = jest.fn(() => rateLimitStoreProvider);
    const logger = {
      info: jest.fn(),
    };

    const result = await startApplicationRuntime({
      appLogger: logger,
      config: { env: 'production' },
      createAppFn,
      createHttpServerFn: jest.fn(() => httpServer),
      createHttpsServerFn: jest.fn(() => httpsServer),
      gracefulShutdownFn,
      initializeDescriptionJobStoreFn,
      initializeRateLimitStoreProviderFn,
      loadTlsCredentialsFn: jest.fn().mockResolvedValue({ key: 'k', cert: 'c' }),
      processRef: createProcessRef(),
      serverPorts: { httpPort: 8080, httpsPort: 8443 },
      startServerFn: jest.fn().mockResolvedValue(undefined),
    });

    expect(result.servers).toEqual([httpServer, httpsServer]);
    expect(result.shutdown).toBe(shutdown);
    expect(result.runtimeState.isReady()).toBe(true);
    expect(createAppFn).toHaveBeenCalledWith(expect.objectContaining({
      config: { env: 'production' },
      appLogger: logger,
      descriptionJobStore,
      rateLimitStoreProvider,
      runtimeState: result.runtimeState,
    }));
    expect(initializeDescriptionJobStoreFn).toHaveBeenCalledWith({
      config: { env: 'production' },
      logger,
    });
    expect(initializeRateLimitStoreProviderFn).toHaveBeenCalledWith({
      config: { env: 'production' },
      logger,
    });
    expect(gracefulShutdownFn).toHaveBeenCalledWith(
      [httpServer, httpsServer],
      logger,
      result.runtimeState,
      expect.any(EventEmitter),
      [expect.any(Function), expect.any(Function)],
    );
  });

  it('cleans up fatal handlers when bootstrap fails before servers are ready', async () => {
    const processRef = createProcessRef();
    const removeListenerSpy = jest.spyOn(processRef, 'off');
    const descriptionJobStore = {
      close: jest.fn().mockResolvedValue(undefined),
    };
    const close = jest.fn().mockResolvedValue(undefined);

    await expect(startApplicationRuntime({
      appLogger: {
        error: jest.fn(),
        fatal: jest.fn(),
        info: jest.fn(),
      },
      config: { env: 'production' },
      createAppFn: jest.fn(() => ({ app: {} })),
      initializeDescriptionJobStoreFn: jest.fn().mockResolvedValue(descriptionJobStore),
      initializeRateLimitStoreProviderFn: jest.fn().mockResolvedValue({
        close,
        createStore: jest.fn(),
        kind: 'memory',
      }),
      loadTlsCredentialsFn: jest.fn().mockRejectedValue(new Error('tls failed')),
      processRef,
    })).rejects.toThrow('tls failed');

    expect(descriptionJobStore.close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(removeListenerSpy).toHaveBeenCalledTimes(2);
    removeListenerSpy.mockRestore();
  });
});
