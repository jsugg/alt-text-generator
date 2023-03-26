const express = require('express');
const apiRouter = express.Router();
const appPath = require('app-root-path').toString();
const WebScrapper = require(`${appPath}/utils/webscrapper`);
const cors =  require('cors');

module.exports = (serverLogger) => {

  function loadAPIRoutes(serverLogger, httpServerLogger) {
    serverLogger.info('Loading APIRoutes...');

    // Ping route
    apiRouter.get(['/ping', '/v1/ping'], (req, res) => {
      httpServerLogger.startTime = Date.now();
      httpServerLogger.info(`${httpServerLogger.startTime} Request received`);
      serverLogger(req, res);
      res.status(200).send('pong');
    });

    // getImages route
    apiRouter.get(['/webScrapper/getImages', '/v1/webScrapper/getImages'], cors(), async (req, res) => {
      httpServerLogger.startTime = Date.now();
      httpServerLogger.logger.info(`${httpServerLogger.startTime} Request received`);
      httpServerLogger(req, res);
      
      const requestUrl = req.query.url;
    
      if (!requestUrl) {
        res.status(400).json({ error: 'Missing required query parameter: url' });
        return;
      }
    
      try {
        const images = await WebScrapper.getImages(requestUrl);
        res.json(images);
      } catch (error) {
        res.status(500).json({ error: 'Error fetching images from the provided URL' });
      }
    });

    // API 404 error handling
    apiRouter.use((req, res, next) => {
      res.status(404).json({ error: 'Endpoint not found' });
      next();
    });

    serverLogger.info('APIRoutes loaded.');
  }

  setImmediate(() => { serverLogger.debug('[MODULE] api/v1/routes/api loaded'); });

  // Module exports
  return {
    loadAPIRoutes,
    apiRouter
  };
};