const ORIGINAL_ENV = process.env;

const mockStdSerializers = {
  err: Symbol('err'),
  req: Symbol('req'),
  res: Symbol('res'),
};

const mockPino = jest.fn();
jest.mock('pino', () => mockPino);

const mockPinoHttp = jest.fn();
mockPinoHttp.stdSerializers = mockStdSerializers;
jest.mock('pino-http', () => mockPinoHttp);

const mockRandomUUID = jest.fn();
jest.mock('crypto', () => ({ randomUUID: mockRandomUUID }));

const mockFs = {
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
};
jest.mock('fs', () => mockFs);

const loadLoggerModule = ({
  env = {},
  randomUUID = 'generated-request-id',
} = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NODE_ENV;
  delete process.env.LOG_LEVEL;

  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });

  mockRandomUUID.mockReset().mockReturnValue(randomUUID);
  mockFs.existsSync.mockReset();
  mockFs.mkdirSync.mockReset();

  const mockChildLogger = { info: jest.fn() };
  const mockAppLogger = {
    child: jest.fn(() => mockChildLogger),
  };
  const mockRequestLogger = jest.fn();

  mockPino.mockReset().mockReturnValue(mockAppLogger);
  mockPinoHttp.mockReset().mockImplementation((options) => {
    mockRequestLogger.logger = options.logger;
    mockRequestLogger.options = options;
    return mockRequestLogger;
  });
  mockPinoHttp.stdSerializers = mockStdSerializers;

  // eslint-disable-next-line global-require
  const loggerModule = require('../../../src/infrastructure/logger');

  return {
    loggerModule,
    mockAppLogger,
    mockChildLogger,
    mockRequestLogger,
    requestLoggerOptions: mockRequestLogger.options,
  };
};

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.clearAllMocks();
  jest.resetModules();
});

describe('infrastructure/logger', () => {
  it('uses process-stream logging in production without touching the filesystem', () => {
    const { loggerModule, mockAppLogger } = loadLoggerModule({
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn',
        LOGS_DIR: '/tmp/alt-text-generator-logs',
      },
    });

    expect(mockPino).toHaveBeenCalledWith({
      level: 'warn',
      name: 'appLogger',
    });
    expect(mockFs.existsSync).not.toHaveBeenCalled();
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    expect(loggerModule.appLogger).toBe(mockAppLogger);
  });

  it('creates the request logger from the app logger child with standard serializers', () => {
    const {
      loggerModule,
      mockAppLogger,
      mockChildLogger,
      mockRequestLogger,
      requestLoggerOptions,
    } = loadLoggerModule({
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
    });

    expect(mockAppLogger.child).toHaveBeenCalledWith({ name: 'serverLogger' });
    expect(mockPinoHttp).toHaveBeenCalledWith(expect.objectContaining({
      logger: mockChildLogger,
      serializers: mockStdSerializers,
      wrapSerializers: true,
    }));
    expect(requestLoggerOptions.logger).toBe(mockChildLogger);
    expect(requestLoggerOptions.serializers).toStrictEqual(mockStdSerializers);
    expect(loggerModule.requestLogger).toBe(mockRequestLogger);
    expect(loggerModule.serverLogger).toBe(mockRequestLogger);
  });

  it('prefers existing request ids before generating a new one', () => {
    const { requestLoggerOptions } = loadLoggerModule({
      env: {
        NODE_ENV: 'production',
      },
      randomUUID: 'generated-id',
    });

    const withReqIdSetHeader = jest.fn();
    expect(requestLoggerOptions.genReqId({
      id: 'existing-id',
      headers: {},
    }, {
      setHeader: withReqIdSetHeader,
    })).toBe('existing-id');
    expect(withReqIdSetHeader).not.toHaveBeenCalled();

    const withHeaderSetHeader = jest.fn();
    expect(requestLoggerOptions.genReqId({
      headers: { 'x-request-id': 'header-id' },
    }, {
      setHeader: withHeaderSetHeader,
    })).toBe('header-id');
    expect(withHeaderSetHeader).not.toHaveBeenCalled();

    const generatedSetHeader = jest.fn();
    expect(requestLoggerOptions.genReqId({
      headers: {},
    }, {
      setHeader: generatedSetHeader,
    })).toBe('generated-id');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    expect(generatedSetHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'generated-id',
    );
  });

  it('maps request outcomes to the expected log levels and messages', () => {
    const { requestLoggerOptions } = loadLoggerModule({
      env: {
        NODE_ENV: 'production',
      },
    });

    expect(requestLoggerOptions.customLogLevel({}, { statusCode: 200 }))
      .toBe('info');
    expect(requestLoggerOptions.customLogLevel({}, { statusCode: 404 }))
      .toBe('warn');
    expect(requestLoggerOptions.customLogLevel({}, { statusCode: 302 }))
      .toBe('silent');
    expect(requestLoggerOptions.customLogLevel({}, { statusCode: 500 }))
      .toBe('error');
    expect(requestLoggerOptions.customLogLevel(
      {},
      { statusCode: 200 },
      new Error('boom'),
    )).toBe('error');

    expect(requestLoggerOptions.customSuccessMessage(
      { method: 'GET' },
      { statusCode: 404 },
    )).toBe('resource not found');
    expect(requestLoggerOptions.customSuccessMessage(
      { method: 'POST' },
      { statusCode: 201 },
    )).toBe('POST completed');
    expect(requestLoggerOptions.customReceivedMessage({ method: 'PATCH' }))
      .toBe('request received: PATCH');
    expect(requestLoggerOptions.customErrorMessage(
      {},
      { statusCode: 503 },
    )).toBe('request errored with status code: 503');
  });
});
