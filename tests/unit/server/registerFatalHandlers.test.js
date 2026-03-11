const { EventEmitter } = require('events');

const {
  normalizeUnhandledRejection,
  registerFatalHandlers,
} = require('../../../src/server/registerFatalHandlers');

const createProcessRef = () => {
  const processRef = new EventEmitter();
  processRef.exit = jest.fn();
  return processRef;
};

describe('Unit | Server | Register Fatal Handlers', () => {
  it('normalizes non-error unhandled rejections into structured fatal logs', () => {
    const normalized = normalizeUnhandledRejection({ status: 'bad-gateway' });

    expect(normalized.reason).toEqual({ status: 'bad-gateway' });
    expect(normalized.err).toBeInstanceOf(Error);
    expect(normalized.err.message).toMatch(/Unhandled promise rejection/);
  });

  it('routes fatal exceptions through the active shutdown handler', async () => {
    const logger = {
      error: jest.fn(),
      fatal: jest.fn(),
    };
    const processRef = createProcessRef();
    const shutdown = jest.fn().mockResolvedValue(undefined);

    registerFatalHandlers({
      getShutdownHandler: () => shutdown,
      logger,
      processRef,
    });

    const error = new Error('boom');
    processRef.emit('uncaughtException', error);
    await Promise.resolve();

    expect(logger.fatal).toHaveBeenCalledWith(
      { err: error },
      'Uncaught exception',
    );
    expect(shutdown).toHaveBeenCalledWith({
      exitCode: 1,
      reason: 'fatal',
      signal: 'Uncaught exception',
    });
    expect(processRef.exit).not.toHaveBeenCalled();
  });

  it('exits immediately when no shutdown handler is available', () => {
    const logger = {
      error: jest.fn(),
      fatal: jest.fn(),
    };
    const processRef = createProcessRef();

    registerFatalHandlers({
      getShutdownHandler: () => undefined,
      logger,
      processRef,
    });

    processRef.emit('unhandledRejection', { code: 'bad-state' });

    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        reason: { code: 'bad-state' },
      }),
      'Unhandled promise rejection',
    );
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });
});
