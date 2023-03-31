"use strict"
const appPath = require('app-root-path').toString();
const os = require('os');
const hostname = os.hostname();
const username = os.userInfo().username;
const packageJSON = require(`${appPath}/package.json`);
const crypto = require('crypto');
const fs = require('fs')
fs.writeFileSync(`${appPath}/alt-text-generator.pid`, process.pid.toString());
const LOGS_FOLDER = `${appPath}/logs/`;
const appLogger = require('pino')({level: 'info', name: 'appLogger', destination: `${LOGS_FOLDER}/${hostname} ${username} ${packageJSON.name} start_date:[${Date.now()}] pid:${process.pid}.log`});
process.on('SIGHUP', () => dest.reopen());
const pinoHttp = require('pino-http');
const serverLogger = pinoHttp({
    logger: appLogger.child({name: 'serverLogger'}),
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
    appLogger,
    serverLogger
}