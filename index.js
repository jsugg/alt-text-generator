require("dotenv").config();
const http = require('http');
const https = require('https');
const express = require('express');
const app = express();
const path = require('path');
const crypto = require('crypto');
const appPath = require('app-root-path').toString();
const fs = require('fs')
fs.writeFileSync(`${appPath}/alt-text-generator.pid`, process.pid.toString());
const LOGS_FOLDER = `${appPath}/logs/`;
const serverLogger = require('pino')({level: 'info', name: 'serverLogger', destination: `${LOGS_FOLDER}/${process.pid}.log`});
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
app.use(httpServerLogger);
const appRouter = require(`${appPath}/api/v1/routes/app`)(serverLogger);
const { loadRequestFilter } = require(`${appPath}/api/v1/middleware/request-filter`)(serverLogger);
const { apiRouter, loadAPIRoutes } = require(`${appPath}/api/v1/routes/api`)(serverLogger);


httpServerLogger.level = 'trace';
serverLogger.level = 'trace';

appRouter.use('/api', apiRouter);

// Load the request filter
loadRequestFilter(serverLogger, httpServerLogger, appRouter);

// Load the API Routes
loadAPIRoutes(serverLogger, httpServerLogger);

// Main router
appRouter.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      apiRouter(req, res, next);
    } else {
      next();
    }
});

app.use(appRouter);

// Start the HTTP Server
(async () => {
    serverLogger.info('Starting HTTP Server...');
  
    // TSL Certificates
    const options = process.env.NODE_ENV === 'production' ? {
            key: Buffer.from(process.env.TSL_KEY, "base64").toString('ascii'),
            cert: Buffer.from(process.env.TSL_CERT, "base64").toString('ascii'),
            /*cors: {
                origin: "http://localhost:8080"
            }*/
        } : 
        {
            key: readFileSync(`${appPath}/certs/key.pem`),
            cert: readFileSync(`${appPath}/certs/cert.pem`)
        };
  
    await new Promise((resolve, reject) => {
      try {
        if (process.env.NODE_ENV === 'production') { 
            PORT = process.env.PORT || 4443;
            const httpsServer = https.createServer(options, app);
              httpsServer.listen(PORT, () => {
                serverLogger.info(`HTTPS server listening on port ${PORT}`);
              });

              resolve([httpsServer]);
        } else {
            const httpServer = http.createServer(app);
            const httpsServer = https.createServer(options, app);
            httpServer.listen(80, '0.0.0.0', () => {
                serverLogger.info('HTTP server listening on port 80');
              });
              
            httpsServer.listen(443, '0.0.0.0', () => {
            serverLogger.info('HTTPS server listening on port 443');

            resolve([httpServer, httpsServer]);
            });
        }
        
      } catch (error) {
        reject(serverLogger.error(error));
      }``
    });
    serverLogger.info('HTTP Server started.');
  })();
  
  
  setImmediate(() => { serverLogger.debug('[MODULE] index object loaded') });