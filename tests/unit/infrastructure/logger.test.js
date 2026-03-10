const ORIGINAL_ENV = process.env;

const mockStdSerializers = {
  err: jest.fn((error) => ({
    type: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code,
    config: error.config,
    response: error.response,
    request: error.request,
    headers: error.headers,
    cause: error.cause
      ? {
        type: error.cause.name,
        message: error.cause.message,
        stack: error.cause.stack,
        config: error.cause.config,
      }
      : undefined,
  })),
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
  mockStdSerializers.err.mockClear();
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
      serializers: {
        err: expect.any(Function),
      },
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
      serializers: expect.objectContaining({
        err: expect.any(Function),
        req: mockStdSerializers.req,
        res: mockStdSerializers.res,
      }),
      wrapSerializers: true,
    }));
    expect(requestLoggerOptions.logger).toBe(mockChildLogger);
    expect(requestLoggerOptions.serializers.req).toBe(mockStdSerializers.req);
    expect(requestLoggerOptions.serializers.res).toBe(mockStdSerializers.res);
    expect(requestLoggerOptions.serializers.err).toEqual(expect.any(Function));
    expect(loggerModule.requestLogger).toBe(mockRequestLogger);
    expect(loggerModule.serverLogger).toBe(mockRequestLogger);
  });

  it('sanitizes serialized errors before they reach the logger output', () => {
    const { requestLoggerOptions } = loadLoggerModule({
      env: {
        NODE_ENV: 'production',
      },
    });

    const cause = new Error('dns lookup failed');
    cause.config = { headers: { Authorization: 'hidden' } };

    const error = new Error('upstream request failed');
    error.code = 'ENOTFOUND';
    error.config = {
      headers: {
        Authorization: 'secret-token',
      },
    };
    error.response = {
      headers: {
        'Ocp-Apim-Subscription-Key': 'secret-key',
      },
    };
    error.request = {
      url: 'https://upstream.example.com',
    };
    error.cause = cause;

    const serialized = requestLoggerOptions.serializers.err(error);

    expect(mockStdSerializers.err).toHaveBeenCalledWith(error);
    expect(serialized).toEqual({
      type: 'Error',
      message: 'upstream request failed',
      stack: error.stack,
      code: 'ENOTFOUND',
      cause: {
        type: 'Error',
        message: 'dns lookup failed',
        stack: cause.stack,
      },
    });
    expect(serialized.config).toBeUndefined();
    expect(serialized.response).toBeUndefined();
    expect(serialized.request).toBeUndefined();
    expect(serialized.headers).toBeUndefined();
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
