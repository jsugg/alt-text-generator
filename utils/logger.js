"use strict"
const appPath = require('app-root-path').toString();
const crypto = require('crypto');
const fs = require('fs')
fs.writeFileSync(`${appPath}/alt-text-generator.pid`, process.pid.toString());
const LOGS_FOLDER = `${appPath}/logs/`;
const serverLogger = require('pino')({level: 'info', name: 'serverLogger', destination: `${LOGS_FOLDER}/date_${Date.now()}__PID_${process.pid}.log`});
process.on('SIGHUP', () => dest.reopen());
const pinoHttp = require('pino-http');
const httpServerLogger = pinoHttp({
    logger: serverLogger.child({name: 'httpServerLogger'}),
        genReqId: function (req, res) {
        const existingID = req.id ?? req.headers["x-request-id"];
        if (existingID) return existingID;
        let id = crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
    },
    serializers: {
        err: pinoHttp.stdSerializers.err,
        req: pinoHttp.stdSerializers.req,
        res: pinoHttp.stdSerializers.res,
        req(req) {
            req.body = req.raw.body;
            return req;
        }
    },
    wrapSerializers: true,
    customLogLevel: function (req, res, err) {
        if (res.statusCode >= 400 && res.statusCode < 500) {
            return 'warn'
        } else if (res.statusCode >= 500 || err) {
            return 'error'
        } else if (res.statusCode >= 300 && res.statusCode < 400) {
            return 'silent'
        }
        return 'info'
    },
    customSuccessMessage: function (req, res) {
        if (res.statusCode === 404) {
            return 'resource not found'
        }
        return `${req.method} completed`
    },
    customReceivedMessage: function (req, res) {
        return 'request received: ' + req.method
    },
    customErrorMessage: function (req, res, err) {
        return 'request errored with status code: ' + res.statusCode
    }
});

module.exports = {
    serverLogger,
    httpServerLogger
}