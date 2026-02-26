const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const pino = require('pino');
const pinoHttp = require('pino-http');
const config = require('../../config');
const packageJSON = require('../../package.json');

const hostname = os.hostname();
const { username } = os.userInfo();
const logsDir = path.resolve(config.logging.logsDir);

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const createAppLogger = () => pino({
  level: config.logging.level,
  name: 'appLogger',
  transport: config.env !== 'production'
    ? undefined
    : {
        target: 'pino/file',
        options: {
          destination: path.join(
            logsDir,
            `${hostname} ${username} ${packageJSON.name} start_date:[${Date.now()}] pid:${process.pid}.log`,
          ),
        },
      },
});

const createServerLogger = (appLogger) => pinoHttp({
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
    customReq(req) {
      req.body = req.raw.body;
      return req;
    },
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
const serverLogger = createServerLogger(appLogger);

module.exports = { appLogger, serverLogger };
