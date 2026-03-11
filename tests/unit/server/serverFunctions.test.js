const { EventEmitter } = require('events');

const {
  closeServers,
  createHttpServer,
  gracefulShutdown,
  startServer,
} = require('../../../src/server/serverFunctions');

const createProcessRef = () => {
  const processRef = new EventEmitter();
  processRef.exit = jest.fn();
  return processRef;
};

describe('Unit | Server | Server Functions', () => {
  it('configures created HTTP servers with conservative timeout defaults', () => {
    const server = createHttpServer(jest.fn());

    expect(server.keepAliveTimeout).toBe(5000);
    expect(server.headersTimeout).toBe(60000);
    expect(server.requestTimeout).toBe(120000);

    server.close();
  });

  it('starts servers and resolves when the listen callback fires', async () => {
    const logger = { info: jest.fn() };
    const server = {
      listen: jest.fn((port) => {
        server.port = port;
        setImmediate(() => server.emit('listening'));
      }),
      off: jest.fn(),
      once: jest.fn((eventName, handler) => {
        server.handlers[eventName] = handler;
      }),
      emit: (eventName, ...args) => server.handlers[eventName]?.(...args),
      handlers: {},
      listening: false,
    };

    await expect(startServer(server, 8443, logger)).resolves.toBe(server);
    expect(server.listen).toHaveBeenCalledWith(8443);
    expect(logger.info).toHaveBeenCalledWith({ port: 8443 }, 'Server listening');
  });

  it('closes all registered servers and closes idle connections first', async () => {
    const firstServer = {
      close: jest.fn((callback) => callback()),
      closeIdleConnections: jest.fn(),
    };
    const secondServer = {
      close: jest.fn((callback) => callback()),
      closeIdleConnections: jest.fn(),
    };

    await closeServers([firstServer, secondServer]);

    expect(firstServer.close).toHaveBeenCalledTimes(1);
    expect(secondServer.close).toHaveBeenCalledTimes(1);
    expect(firstServer.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(secondServer.closeIdleConnections).toHaveBeenCalledTimes(1);
  });

  it('shuts servers down gracefully on SIGTERM and exits with code 0', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
    };
    const processRef = createProcessRef();
    const cleanupTask = jest.fn().mockResolvedValue(undefined);
    const runtimeState = {
      markDraining: jest.fn(),
    };
    const server = {
      close: jest.fn((callback) => callback()),
      closeIdleConnections: jest.fn(),
    };

    const shutdown = gracefulShutdown([server], logger, runtimeState, processRef, [cleanupTask]);
    processRef.emit('SIGTERM');
    await shutdown({ exitCode: 0, reason: 'signal', signal: 'SIGTERM' });

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(cleanupTask).toHaveBeenCalledTimes(1);
    expect(runtimeState.markDraining).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { exitCode: 0, reason: 'signal', signal: 'SIGTERM' },
      'Closing servers',
    );
    expect(logger.info).toHaveBeenCalledWith('All servers closed gracefully');
    expect(processRef.exit).toHaveBeenCalledWith(0);
  });

  it('escalates shutdown failures to exit code 1', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
    };
    const processRef = createProcessRef();
    const cleanupTask = jest.fn().mockRejectedValue(new Error('cleanup failed'));
    const closeError = new Error('close failed');
    const server = {
      close: jest.fn((callback) => callback(closeError)),
      closeIdleConnections: jest.fn(),
    };

    const shutdown = gracefulShutdown([server], logger, undefined, processRef, cleanupTask);
    processRef.emit('SIGINT');
    await shutdown({ exitCode: 1, reason: 'signal', signal: 'SIGINT' });

    expect(logger.error).toHaveBeenCalledWith(
      { err: closeError },
      'Error during graceful shutdown',
    );
    expect(logger.error).toHaveBeenCalledWith(
      { err: new Error('cleanup failed') },
      'Error during shutdown cleanup',
    );
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });
});
