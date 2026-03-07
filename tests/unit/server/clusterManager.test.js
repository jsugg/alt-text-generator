const { setupCluster } = require('../../../src/server/clusterManager');

describe('setupCluster', () => {
  it('forks the requested number of workers and replaces dead workers', () => {
    const cluster = {
      setupPrimary: jest.fn(),
      fork: jest.fn(),
      on: jest.fn(),
    };
    const logger = {
      info: jest.fn(),
    };

    setupCluster(cluster, logger, 3);

    expect(cluster.setupPrimary).toHaveBeenCalledTimes(1);
    expect(cluster.fork).toHaveBeenCalledTimes(3);
    expect(cluster.on).toHaveBeenCalledWith('exit', expect.any(Function));

    const exitHandler = cluster.on.mock.calls[0][1];
    exitHandler({ process: { pid: 4321 } }, 1, 'SIGTERM');

    expect(logger.info).toHaveBeenCalledWith(
      { pid: 4321, code: 1, signal: 'SIGTERM' },
      'Worker died, restarting',
    );
    expect(cluster.fork).toHaveBeenCalledTimes(4);
  });

  it('falls back to a single worker when the requested count is invalid', () => {
    const cluster = {
      setupPrimary: jest.fn(),
      fork: jest.fn(),
      on: jest.fn(),
    };

    setupCluster(cluster, { info: jest.fn() }, 0);

    expect(cluster.fork).toHaveBeenCalledTimes(1);
  });
});
