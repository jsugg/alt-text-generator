const { EventEmitter } = require('events');

const {
  closeServers,
  gracefulShutdown,
} = require('../../../src/server/serverFunctions');

const createProcessRef = () => {
  const processRef = new EventEmitter();
  processRef.exit = jest.fn();
  return processRef;
};

describe('serverFunctions', () => {
  it('closes all registered servers', async () => {
    const firstServer = { close: jest.fn((callback) => callback()) };
    const secondServer = { close: jest.fn((callback) => callback()) };

    await closeServers([firstServer, secondServer]);

    expect(firstServer.close).toHaveBeenCalledTimes(1);
    expect(secondServer.close).toHaveBeenCalledTimes(1);
  });

  it('shuts servers down gracefully on SIGTERM and exits with code 0', async () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
    };
    const processRef = createProcessRef();
    const server = { close: jest.fn((callback) => callback()) };

    const shutdown = gracefulShutdown([server], logger, processRef);
    processRef.emit('SIGTERM');
    await shutdown({ exitCode: 0, reason: 'signal', signal: 'SIGTERM' });

    expect(server.close).toHaveBeenCalledTimes(1);
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
    const closeError = new Error('close failed');
    const server = { close: jest.fn((callback) => callback(closeError)) };

    const shutdown = gracefulShutdown([server], logger, processRef);
    processRef.emit('SIGINT');
    await shutdown({ exitCode: 1, reason: 'signal', signal: 'SIGINT' });

    expect(logger.error).toHaveBeenCalledWith(
      { err: closeError },
      'Error during graceful shutdown',
    );
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });
});
