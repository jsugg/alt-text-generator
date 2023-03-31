"use strict"
require("dotenv").config();
const appPath = require('app-root-path').toString();
const http = require('http');
const https = require('https');
const express = require('express');
const app = express();
const { appLogger, serverLogger } = require(`${appPath}/utils/logger`);
const appRouter = require(`${appPath}/api/v1/routes/app`)(serverLogger);
const swaggerRouter = require('express').Router();
const { loadRequestFilter } = require(`${appPath}/api/v1/middleware/request-filter`)(serverLogger);
const { apiRouter, loadAPIRoutes } = require(`${appPath}/api/v1/routes/api`)(serverLogger);
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require(`${appPath}/swagger`);

// Set log level
serverLogger.logger.level = 'trace';
appLogger.level = 'trace';

// Load the apiRouter into the appRouter
appRouter.use('/api', apiRouter);

swaggerRouter.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Load the request filter
loadRequestFilter(serverLogger, appRouter);

// Load the API routes
loadAPIRoutes(serverLogger);

// Main router; appRouter assigns routers to the specified routes
appRouter.use((req, res, next) => {
    if (req.path.startsWith('/api-docs')) {
      swaggerRouter(req, res, next);
    } else if (req.path.startsWith('/api')) {
      apiRouter(req, res, next);
    } else {
      next();
    }
});

app.use(serverLogger);
app.use(appRouter);

// Start the HTTP Server
(async () => {
    serverLogger.logger.info('Starting HTTP Server...');
    const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || '';

    // TLS Certificates
    const options = process.env.NODE_ENV === 'production' ? {
        // The server is currently handling certificates.
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
                serverLogger.logger.info(`HTTP server listening on port ${PORT}`);
              });

              resolve([httpsServer]);
        } else {
            const httpServer = http.createServer(app);
            const httpsServer = https.createServer(options, app);
            httpServer.listen(8080, '0.0.0.0', () => {
                serverLogger.logger.info('HTTP server listening on port 80');
              });
              
            httpsServer.listen(4443, '0.0.0.0', () => {
            serverLogger.logger.info('HTTPS server listening on port 443');

            resolve([httpServer, httpsServer]);
            });
        }
        
      } catch (error) {
        reject(serverLogger.logger.error(error));
      }
    });
    serverLogger.logger.info('HTTP Server started.');
  })();
  
  
  setImmediate(() => { serverLogger.logger.debug('[MODULE] index object loaded') });