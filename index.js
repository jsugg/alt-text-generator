"use strict"
require("dotenv").config();
const appPath = require('app-root-path').toString();
const http = require('http');
const https = require('https');
const express = require('express');
const app = express();
const { serverLogger, httpServerLogger } = require(`${appPath}/utils/logger`);
const appRouter = require(`${appPath}/api/v1/routes/app`)(serverLogger);
const { loadRequestFilter } = require(`${appPath}/api/v1/middleware/request-filter`)(serverLogger);
const { apiRouter, loadAPIRoutes } = require(`${appPath}/api/v1/routes/api`)(serverLogger);
const fs = require('fs');
// End Requires

// Set log level
httpServerLogger.level = 'trace';
serverLogger.level = 'trace';

// Load the apiRouter into the appRouter
appRouter.use('/api', apiRouter);

// Load the request filter
loadRequestFilter(serverLogger, httpServerLogger, appRouter);

// Load the API routes
loadAPIRoutes(serverLogger, httpServerLogger);

// Main router; appRouter assigns routers to the specified routes
appRouter.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      apiRouter(req, res, next);
    } else {
      next();
    }
});
app.use(httpServerLogger);
app.use(appRouter);

// Start the HTTP Server
(async () => {
    serverLogger.info('Starting HTTP Server...');
    const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || '';

    // TLS Certificates
    const options = process.env.NODE_ENV === 'production' ? {
           /* key: Buffer.from(process.env.TSL_KEY, "base64").toString('ascii'),
            cert: Buffer.from(process.env.TSL_CERT, "base64").toString('ascii'),
            cors: {
                origin: RENDER_EXTERNAL_URL
            }*/
        } : 
        {
            key: fs.readFileSync(`${appPath}/certs/key.pem`),
            cert: fs.readFileSync(`${appPath}/certs/cert.pem`)
        };
  
    await new Promise((resolve, reject) => {
      try {
        if (process.env.NODE_ENV === 'production') { 
            const PORT = process.env.PORT || 8080;

            const httpsServer = http.createServer(app);
              httpsServer.listen(PORT, () => {
                serverLogger.info(`HTTP server listening on port ${PORT}`);
              });

              resolve([httpsServer]);
        } else {
            const httpServer = http.createServer(app);
            const httpsServer = https.createServer(options, app);
            httpServer.listen(8080, '0.0.0.0', () => {
                serverLogger.info('HTTP server listening on port 80');
              });
              
            httpsServer.listen(4443, '0.0.0.0', () => {
            serverLogger.info('HTTPS server listening on port 443');

            resolve([httpServer, httpsServer]);
            });
        }
        
      } catch (error) {
        reject(serverLogger.error(error));
      }
    });
    serverLogger.info('HTTP Server started.');
  })();
  
  
  setImmediate(() => { serverLogger.debug('[MODULE] index object loaded') });