const { EventEmitter } = require('events');

const {
  resolveWorkerCount,
  shouldUseCluster,
  startApplication,
  writePrimaryPidFile,
} = require('../../../src/server/runtimeBootstrap');

const createProcessRef = () => {
  const processRef = new EventEmitter();
  processRef.exit = jest.fn();
  processRef.pid = 4321;
  return processRef;
};

describe('Unit | Server | Runtime Bootstrap', () => {
  it('derives worker count and cluster mode from config', () => {
    expect(resolveWorkerCount({ cluster: { workers: 1 } })).toBe(1);
    expect(resolveWorkerCount({ cluster: { workers: 4 } })).toBe(4);
    expect(shouldUseCluster(1)).toBe(false);
    expect(shouldUseCluster(4)).toBe(true);
  });

  it('writes the pid file only from the primary process', () => {
    const fsModule = {
      writeFileSync: jest.fn(),
    };

    writePrimaryPidFile({
      cluster: { isPrimary: true },
      fsModule,
      pidFile: '/tmp/app.pid',
      processRef: { pid: 9001 },
    });
    writePrimaryPidFile({
      cluster: { isPrimary: false },
      fsModule,
      pidFile: '/tmp/app.pid',
      processRef: { pid: 9002 },
    });

    expect(fsModule.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fsModule.writeFileSync).toHaveBeenCalledWith('/tmp/app.pid', '9001');
  });

  it('starts single-process runtime when worker count is one', async () => {
    const logger = {
      fatal: jest.fn(),
      info: jest.fn(),
    };
    const processRef = createProcessRef();
    const fsModule = {
      writeFileSync: jest.fn(),
    };
    const setupClusterFn = jest.fn();
    const startRuntimeFn = jest.fn().mockResolvedValue(undefined);

    await startApplication({
      cluster: { isPrimary: true },
      config: {
        env: 'production',
        cluster: { workers: 1 },
      },
      fsModule,
      logger,
      pidFile: '/tmp/app.pid',
      processRef,
      setupClusterFn,
      startRuntimeFn,
    });

    expect(fsModule.writeFileSync).toHaveBeenCalledWith('/tmp/app.pid', '4321');
    expect(startRuntimeFn).toHaveBeenCalledTimes(1);
    expect(setupClusterFn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { workerCount: 1, env: 'production' },
      'Starting single-process runtime',
    );
  });

  it('starts clustered mode only from the primary process', async () => {
    const logger = {
      fatal: jest.fn(),
      info: jest.fn(),
    };
    const processRef = createProcessRef();
    const setupClusterFn = jest.fn();
    const startRuntimeFn = jest.fn();

    await startApplication({
      cluster: { isPrimary: true },
      config: {
        env: 'production',
        cluster: { workers: 3, restartBackoffMs: 1000 },
      },
      logger,
      processRef,
      setupClusterFn,
      startRuntimeFn,
    });

    expect(setupClusterFn).toHaveBeenCalledWith(
      { isPrimary: true },
      logger,
      3,
      { workers: 3, restartBackoffMs: 1000 },
      processRef,
    );
    expect(startRuntimeFn).not.toHaveBeenCalled();
  });

  it('logs and exits when runtime bootstrap fails', async () => {
    const logger = {
      fatal: jest.fn(),
      info: jest.fn(),
    };
    const processRef = createProcessRef();
    const error = new Error('tls boom');

    await startApplication({
      cluster: { isPrimary: true },
      config: {
        env: 'production',
        cluster: { workers: 1 },
      },
      logger,
      processRef,
      setupClusterFn: jest.fn(),
      startRuntimeFn: jest.fn().mockRejectedValue(error),
    });

    expect(logger.fatal).toHaveBeenCalledWith(
      { err: error },
      'Runtime bootstrap failed',
    );
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });
});
