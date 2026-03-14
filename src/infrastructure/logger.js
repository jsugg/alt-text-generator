const crypto = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');
const config = require('../../config');

const REDACTED_HEADER_VALUE = '[Redacted]';
const SENSITIVE_LOGGED_HEADERS = new Set([
  'authorization',
  'cookie',
  'ocp-apim-subscription-key',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
]);

const redactLoggedHeaders = (headers) => {
  if (!headers || typeof headers !== 'object') {
    return headers;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_LOGGED_HEADERS.has(name.toLowerCase())
        ? REDACTED_HEADER_VALUE
        : value,
    ]),
  );
};

const serializeLoggedError = (error) => {
  const serialized = pinoHttp.stdSerializers.err(error);
  const serializedCause = error?.cause ? serializeLoggedError(error.cause) : undefined;

  if (!serialized || typeof serialized !== 'object') {
    return serialized;
  }

  return {
    ...(serialized.type ? { type: serialized.type } : {}),
    ...(serialized.message ? { message: serialized.message } : {}),
    ...(serialized.stack ? { stack: serialized.stack } : {}),
    ...(serialized.code ? { code: serialized.code } : {}),
    ...(serialized.signal ? { signal: serialized.signal } : {}),
    ...(serializedCause ? { cause: serializedCause } : {}),
  };
};

const serializeLoggedRequest = (request) => {
  const serialized = pinoHttp.stdSerializers.req(request);

  if (!serialized || typeof serialized !== 'object') {
    return serialized;
  }

  return {
    ...serialized,
    ...(serialized.headers ? { headers: redactLoggedHeaders(serialized.headers) } : {}),
  };
};

const serializeLoggedResponse = (response) => {
  const serialized = pinoHttp.stdSerializers.res(response);

  if (!serialized || typeof serialized !== 'object') {
    return serialized;
  }

  return {
    ...serialized,
    ...(serialized.headers ? { headers: redactLoggedHeaders(serialized.headers) } : {}),
  };
};

const createAppLogger = () => pino({
  level: config.logging.level,
  name: 'appLogger',
  serializers: {
    err: serializeLoggedError,
  },
});

const createRequestLogger = (appLogger) => pinoHttp({
  logger: appLogger.child({ name: 'serverLogger' }),
  genReqId: (req, res) => {
    const existingID = req.id ?? req.headers['x-request-id'];
    if (existingID) return existingID;
    const id = crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  serializers: {
    err: serializeLoggedError,
    req: serializeLoggedRequest,
    res: serializeLoggedResponse,
  },
  wrapSerializers: false,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 300 && res.statusCode < 400) return 'silent';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    if (res.statusCode === 404) return 'resource not found';
    return `${req.method} completed`;
  },
  customReceivedMessage: (req) => `request received: ${req.method}`,
  customErrorMessage: (req, res) => `request errored with status code: ${res.statusCode}`,
});

const appLogger = createAppLogger();
const requestLogger = createRequestLogger(appLogger);

module.exports = {
  appLogger,
  requestLogger,
  serverLogger: requestLogger,
};
