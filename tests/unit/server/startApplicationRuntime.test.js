const { EventEmitter } = require('events');

const { startApplicationRuntime } = require('../../../src/server/startApplicationRuntime');

const createProcessRef = () => {
  const processRef = new EventEmitter();
  processRef.exit = jest.fn();
  return processRef;
};

describe('startApplicationRuntime', () => {
  it('starts both servers and registers graceful shutdown', async () => {
    const app = { name: 'express-app' };
    const httpServer = { kind: 'http' };
    const httpsServer = { kind: 'https' };
    const shutdown = jest.fn();
    const logger = {
      info: jest.fn(),
    };

    const result = await startApplicationRuntime({
      appLogger: logger,
      config: { env: 'production' },
      createAppFn: jest.fn(() => ({ app })),
      createHttpServerFn: jest.fn(() => httpServer),
      createHttpsServerFn: jest.fn(() => httpsServer),
      gracefulShutdownFn: jest.fn(() => shutdown),
      loadTlsCredentialsFn: jest.fn().mockResolvedValue({ key: 'k', cert: 'c' }),
      processRef: createProcessRef(),
      serverPorts: { httpPort: 8080, httpsPort: 8443 },
      startServerFn: jest.fn(),
    });

    expect(result.servers).toEqual([httpServer, httpsServer]);
    expect(result.shutdown).toBe(shutdown);
  });

  it('cleans up fatal handlers when bootstrap fails before servers are ready', async () => {
    const processRef = createProcessRef();
    const removeListenerSpy = jest.spyOn(processRef, 'off');

    await expect(startApplicationRuntime({
      appLogger: {
        fatal: jest.fn(),
        info: jest.fn(),
      },
      config: { env: 'production' },
      createAppFn: jest.fn(() => ({ app: {} })),
      loadTlsCredentialsFn: jest.fn().mockRejectedValue(new Error('tls failed')),
      processRef,
    })).rejects.toThrow('tls failed');

    expect(removeListenerSpy).toHaveBeenCalledTimes(2);
    removeListenerSpy.mockRestore();
  });
});
