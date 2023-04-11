"use strict";

const os = require("os");
const crypto = require("crypto");
const fs = require("fs");
const pino = require("pino");
const pinoHttp = require("pino-http");
const appPath = require("app-root-path").toString();
const packageJSON = require(`${appPath}/package.json`);

const hostname = os.hostname();
const username = os.userInfo().username;
const logsFolder = `${appPath}/logs/`;

fs.writeFileSync(`${appPath}/alt-text-generator.pid`, process.pid.toString());

const createAppLogger = () => {
  return pino({
    level: "info",
    name: "appLogger",
    destination: `${logsFolder}/${hostname} ${username} ${
      packageJSON.name
    } start_date:[${Date.now()}] pid:${process.pid}.log`,
  });
};

const createServerLogger = (appLogger) => {
  return pinoHttp({
    logger: appLogger.child({ name: "serverLogger" }),
    genReqId: (req, res) => {
      const existingID = req.id ?? req.headers["x-request-id"];
      if (existingID) return existingID;
      const id = crypto.randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    serializers: {
      err: pinoHttp.stdSerializers.err,
      req: pinoHttp.stdSerializers.req,
      res: pinoHttp.stdSerializers.res,
      req(req) {
        req.body = req.raw.body;
        return req;
      },
    },
    wrapSerializers: true,
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 400 && res.statusCode < 500) {
        return "warn";
      } else if (res.statusCode >= 500 || err) {
        return "error";
      } else if (res.statusCode >= 300 && res.statusCode < 400) {
        return "silent";
      }
      return "info";
    },
    customSuccessMessage: (req, res) => {
      if (res.statusCode === 404) {
        return "resource not found";
      }
      return `${req.method} completed`;
    },
    customReceivedMessage: (req, res) => {
      return `request received: ${req.method}`;
    },
    customErrorMessage: (req, res, err) => {
      return `request errored with status code: ${res.statusCode}`;
    },
  });
};

const appLogger = createAppLogger();
const serverLogger = createServerLogger(appLogger);

module.exports = {
  appLogger,
  serverLogger,
};

// Path: utils/logger.js
