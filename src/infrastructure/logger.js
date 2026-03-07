const crypto = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');
const config = require('../../config');

const createAppLogger = () => pino({
  level: config.logging.level,
  name: 'appLogger',
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
    err: pinoHttp.stdSerializers.err,
    req: pinoHttp.stdSerializers.req,
    res: pinoHttp.stdSerializers.res,
  },
  wrapSerializers: true,
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
