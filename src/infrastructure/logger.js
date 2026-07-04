const crypto = require('crypto');

/** @typedef {typeof import('pino-http')} PinoHttpModule */

// pino and pino-http publish ESM-shaped types; the CJS export is the callable
// default with the namespace members attached, so cast once at the require.
const pino = /** @type {typeof import('pino')['default']} */ (
  /** @type {unknown} */ (require('pino'))
);
const pinoHttp = /** @type {PinoHttpModule['default'] & PinoHttpModule} */ (
  /** @type {unknown} */ (require('pino-http'))
);
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

/**
 * @param {Record<string, unknown> | null | undefined} headers
 * @returns {Record<string, unknown> | null | undefined}
 */
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

/**
 * @param {Error & { cause?: unknown }} error
 * @returns {object}
 */
const serializeLoggedError = (error) => {
  const serialized = pinoHttp.stdSerializers.err(error);
  const serializedCause = error?.cause
    ? serializeLoggedError(/** @type {Error & { cause?: unknown }} */ (error.cause))
    : undefined;

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

/**
 * @param {Parameters<typeof pinoHttp.stdSerializers.req>[0]} request
 * @returns {object}
 */
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

/**
 * @param {Parameters<typeof pinoHttp.stdSerializers.res>[0]} response
 * @returns {object}
 */
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

/**
 * @param {import('pino').Logger} appLogger
 * @returns {import('pino-http').HttpLogger}
 */
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
