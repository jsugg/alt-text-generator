/**
 * @file Main server entry point
 * @author Juan Sugg
 * @version 1.0
 */

// Node Modules
const cluster = require('cluster');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Third-party Modules
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const Joi = require('joi');

// Custom Modules
const { appLogger, serverLogger } = require('./utils/logger');
const { loadRequestFilter } = require('./api/v1/middleware/request-filter')(serverLogger);
const { apiRouter, loadAPIRoutes } = require('./api/v1/routes/api')(serverLogger);
const swaggerSpec = require('../config/swagger');

// Set log level
serverLogger.logger.level = 'trace';
appLogger.level = 'trace';

// Validate Environment Variables
const envVarsSchema = Joi.object({
  PORT: Joi.number().required(),
  TLS_PORT: Joi.number().required(),
}).unknown().required();

const { error: envVarsError } = envVarsSchema.validate(process.env);
if (envVarsError) {
  serverLogger.logger.error(`Config validation error: ${envVarsError.message}`);
  process.exit(1);
}

// Initialize Express App
const app = express();

// Security Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
  }),
);
app.use(cors());

// Logger and Rate Limiter
app.use(serverLogger);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: 'Too many requests, please try again later.' }));

// Error Handling
// app.use((err, req, res, next) => {
//   serverLogger.logger.error(`Error: ${err.message}\nStack: ${err.stack}`);
//   if (res) {
//     res.status(err.status || 500).json({ error: err.message });
//   }
//   next(err);
// });

// API Routes
const appRouter = express.Router();
loadRequestFilter(serverLogger, appRouter);
loadAPIRoutes(serverLogger);
appRouter.use('/api', apiRouter);

// Swagger Documentation
const swaggerRouter = express.Router();
swaggerRouter.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Main Router
appRouter.use((req, res, next) => {
  if (req.path.startsWith('/api-docs')) {
    swaggerRouter(req, res, next);
  } else if (req.path.startsWith('/api')) {
    apiRouter(req, res, next);
  } else {
    next();
  }
});

app.use(appRouter);

// Health Check Endpoint
app.get('/health', (req, res) => res.status(200).send('OK'));

// Server Initialization Function
const initServer = async () => {
  serverLogger.logger.info('Starting server...');

  // TLS Certificates and Ports
  const options = process.env.NODE_ENV === 'production'
    ? {
      key: process.env.TLS_KEY
        ? Buffer.from(process.env.TLS_KEY, 'base64').toString('ascii')
        : fs.readFileSync(path.join(__dirname, '../certs/localhost-key.pem')),
      cert: process.env.TLS_CERT
        ? Buffer.from(process.env.TLS_CERT, 'base64').toString('ascii')
        : fs.readFileSync(path.join(__dirname, '../certs/localhost.pem')),
    }
    : {
      key: fs.readFileSync(path.join(__dirname, '../certs/localhost-key.pem')),
      cert: fs.readFileSync(path.join(__dirname, '../certs/localhost.pem')),
    };
  const ports = {
    p: process.env.PORT || (process.env.NODE_ENV === 'production' ? 8080 : 80),
    tls: process.env.TLS_PORT || (process.env.NODE_ENV === 'production' ? 4443 : 443),
  };

  // Create HTTP and HTTPS servers
  const httpServer = http.createServer(app);
  const httpsServer = https.createServer(options, app);

  // Start listening on ports
  await new Promise((resolve) => {
    httpServer.listen(ports.p, '0.0.0.0', () => {
      serverLogger.logger.info(`HTTP server listening on port ${ports.p}`);
    });

    httpsServer.listen(ports.tls, '0.0.0.0', () => {
      serverLogger.logger.info(`HTTPS server listening on port ${ports.tls}`);
    });

    // Graceful Shutdown
    const shutdown = () => {
      httpServer.close(() => {
        httpsServer.close(() => {
          process.exit(0);
        });
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    serverLogger.logger.info('Server started.');

    resolve([httpServer, httpsServer]);
  });
};

// Cluster Mode Initialization
if (cluster.isMaster) {
  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i += 1) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    serverLogger.logger.info(`Worker ${worker.process.pid} died, code: ${code}, signal: ${signal}`);
    cluster.fork();
  });
  cluster.on('message', (worker, message) => {
    serverLogger.logger.info(`Message from worker ${worker.process.pid}: ${message}`);
  });
} else {
  initServer().catch((err) => {
    serverLogger.logger.error(`Server Initialization Error: ${err.message}`);
    process.exit(1);
  });
}
