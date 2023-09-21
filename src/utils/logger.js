/**
 * Creates a logger for the application and a server logger using the pino and pino-http libraries.
 *
 * @module logger
 */

const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const pino = require('pino');
const pinoHttp = require('pino-http');

const packageJSON = require('../../package.json');

const hostname = os.hostname();
const { username } = os.userInfo();
const logsFolder = '../../logs/';

fs.writeFileSync('../../alt-text-generator.pid', process.pid.toString());

/**
 * Creates a pino logger for the application.
 *
 * @function createAppLogger
 * @returns {Object} - The pino logger object.
 */
const createAppLogger = () => pino({
  level: 'info',
  name: 'appLogger',
  destination: `${logsFolder}/${hostname} ${username} ${
    packageJSON.name
  } start_date:[${Date.now()}] pid:${process.pid}.log`,
});

/**
 * Creates a pino-http server logger with options and serializers.
 *
 * @function createServerLogger
 * @param {Object} appLogger - The pino logger object for the application.
 * @returns {Object} - The pino-http server logger object.
 */
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
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    }
    if (res.statusCode >= 500 || err) {
      return 'error';
    }
    if (res.statusCode >= 300 && res.statusCode < 400) {
      return 'silent';
    }
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    if (res.statusCode === 404) {
      return 'resource not found';
    }
    return `${req.method} completed`;
  },
  customReceivedMessage: (req) => `request received: ${req.method}`,
  customErrorMessage: (req, res) => `request errored with status code: ${res.statusCode}`,
});

const appLogger = createAppLogger();
const serverLogger = createServerLogger(appLogger);

module.exports = {
  appLogger,
  serverLogger,
};
