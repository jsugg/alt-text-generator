const { EventEmitter } = require('events');

const {
  calculateRestartDelay,
  resolveClusterPolicy,
  setupCluster,
} = require('../../../src/server/clusterManager');

const createCluster = () => {
  const cluster = new EventEmitter();
  cluster.setupPrimary = jest.fn();
  cluster.fork = jest.fn();
  cluster.disconnect = jest.fn((callback) => callback());
  return cluster;
};

const createLogger = () => ({
  error: jest.fn(),
  fatal: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
});

const createProcessRef = () => {
  const processRef = new EventEmitter();
  processRef.exit = jest.fn();
  return processRef;
};

const createWorker = (pid, overrides = {}) => ({
  exitedAfterDisconnect: false,
  process: { pid },
  ...overrides,
});

describe('Unit | Server | Cluster Manager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-07T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves the documented cluster policy defaults', () => {
    expect(resolveClusterPolicy()).toEqual({
      crashWindowMs: 60000,
      maxCrashCount: 5,
      maxRestartBackoffMs: 30000,
      restartBackoffMs: 1000,
      shutdownTimeoutMs: 10000,
    });
  });

  it('caps exponential restart backoff at the configured maximum', () => {
    expect(calculateRestartDelay({
      unexpectedExitCount: 1,
      restartBackoffMs: 1000,
      maxRestartBackoffMs: 5000,
    })).toBe(1000);
    expect(calculateRestartDelay({
      unexpectedExitCount: 3,
      restartBackoffMs: 1000,
      maxRestartBackoffMs: 5000,
    })).toBe(4000);
    expect(calculateRestartDelay({
      unexpectedExitCount: 6,
      restartBackoffMs: 1000,
      maxRestartBackoffMs: 5000,
    })).toBe(5000);
  });

  it('forks the requested number of workers and restarts unexpected exits with backoff', () => {
    const cluster = createCluster();
    const logger = createLogger();
    const processRef = createProcessRef();

    setupCluster(cluster, logger, 2, {
      restartBackoffMs: 100,
      maxRestartBackoffMs: 1000,
      crashWindowMs: 1000,
      maxCrashCount: 5,
      shutdownTimeoutMs: 500,
    }, processRef);

    expect(cluster.setupPrimary).toHaveBeenCalledTimes(1);
    expect(cluster.fork).toHaveBeenCalledTimes(2);

    cluster.emit('exit', createWorker(4321), 1, null);

    expect(logger.warn).toHaveBeenCalledWith(
      {
        code: 1,
        pid: 4321,
        restartDelayMs: 100,
        signal: null,
        unexpectedExitCount: 1,
      },
      'Worker died unexpectedly, scheduling restart',
    );
    expect(cluster.fork).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(99);
    expect(cluster.fork).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1);
    expect(cluster.fork).toHaveBeenCalledTimes(3);
  });

  it('does not restart workers that exit intentionally', () => {
    const cluster = createCluster();
    const logger = createLogger();
    const processRef = createProcessRef();

    setupCluster(cluster, logger, 2, {}, processRef);

    cluster.emit('exit', createWorker(4321, { exitedAfterDisconnect: true }), 0, null);

    expect(logger.info).toHaveBeenCalledWith(
      { pid: 4321, code: 0, signal: null },
      'Worker exited intentionally',
    );
    jest.runAllTimers();
    expect(cluster.fork).toHaveBeenCalledTimes(2);
  });

  it('exits the primary when the crash budget is exhausted', () => {
    const cluster = createCluster();
    const logger = createLogger();
    const processRef = createProcessRef();

    setupCluster(cluster, logger, 1, {
      restartBackoffMs: 100,
      maxRestartBackoffMs: 1000,
      crashWindowMs: 1000,
      maxCrashCount: 1,
      shutdownTimeoutMs: 500,
    }, processRef);

    cluster.emit('exit', createWorker(4321), 1, null);
    cluster.emit('exit', createWorker(5432), 1, null);

    expect(logger.fatal).toHaveBeenCalledWith(
      {
        code: 1,
        crashWindowMs: 1000,
        maxCrashCount: 1,
        pid: 5432,
        signal: null,
        unexpectedExitCount: 2,
      },
      'Cluster crash budget exhausted',
    );
    expect(cluster.disconnect).toHaveBeenCalledTimes(1);
    expect(processRef.exit).toHaveBeenCalledWith(1);

    jest.runAllTimers();
    expect(cluster.fork).toHaveBeenCalledTimes(1);
  });

  it('shuts down the primary on SIGTERM without scheduling restarts', () => {
    const cluster = createCluster();
    const logger = createLogger();
    const processRef = createProcessRef();

    setupCluster(cluster, logger, 2, {
      shutdownTimeoutMs: 500,
    }, processRef);

    processRef.emit('SIGTERM');
    cluster.emit('exit', createWorker(4321), 0, 'SIGTERM');

    expect(cluster.disconnect).toHaveBeenCalledTimes(1);
    expect(processRef.exit).toHaveBeenCalledWith(0);
    expect(logger.info).toHaveBeenCalledWith(
      { pid: 4321, code: 0, signal: 'SIGTERM' },
      'Worker exited intentionally',
    );
    jest.runAllTimers();
    expect(cluster.fork).toHaveBeenCalledTimes(2);
  });
});
