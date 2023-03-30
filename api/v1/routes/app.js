"use strict"
const express = require('express');
const appRouter = express.Router();

module.exports = function(serverLogger) {
  
  // Routes and middleware here

  setImmediate(() => { serverLogger.logger.debug('[MODULE] api/v1/routes/app loaded') });

  return appRouter;
};
