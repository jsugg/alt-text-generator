"use strict"
const express = require('express');
const apiRouter = express.Router();
const appPath = require('app-root-path').toString();
const WebScrapper = require(`${appPath}/utils/webscrapper`);
const AzureImageDescriber = require(`${appPath}/utils/azure-image-describer`);
const ReplicateImageDescriber = require(`${appPath}/utils/replicate-image-describer`);
const cors =  require('cors');

module.exports = (serverLogger) => {

  apiRouter.use((req, res, next) => {
    req.log = serverLogger;
    next();
  });
  
  function loadAPIRoutes(serverLogger) {
    serverLogger.logger.info('Loading APIRoutes...');

    // Ping
    apiRouter.get(['/ping', '/v1/ping'], (req, res) => {
      req.log.startTime = Date.now();
      req.log.logger.info(`${req.log.startTime} Request received`);
      req.log(req, res);
      res.status(200).send('pong');
    });

    // getImages from external URL
    apiRouter.get(['/webScrapper/getImages', '/v1/webScrapper/getImages'], cors(), async (req, res) => {
      req.log.startTime = Date.now();
      req.log.logger.info(`${req.log.startTime} Request received`);
      req.log(req, res);
      
      const requestUrl = req.query.url;
      req.log.logger.debug(`Queried URL: ${requestUrl}`);

      if (!requestUrl) {
        res.status(400).json({ error: 'Missing required query parameter: url' });
        return;
      }
      try {
        const images = await WebScrapper.getImages(requestUrl);
        res.json(images);
        req.log.logger.debug(`Response sent with images: ${JSON.stringify(images)}`);
      } catch (error) {
        res.status(500).json({ error: 'Error fetching images from the provided URL' });
      }
    });

    // Get Alt Text for images
    apiRouter.get(['/accessibility/getImageDescriptions', '/v1/accessibility/getImageDescriptions'], cors(), async (req, res) => {
      req.log.startTime = Date.now();
      req.log.logger.info(`${req.log.startTime} Request received`);
      req.log(req, res);

      const imagesSource = req.query.imagesSource;
      const model = req.query.model;
      req.log.logger.debug(`Model: ${model}, imagesSource: ${imagesSource}`);

      if (!imagesSource || !model) {
        res.status(400).json({ error: 'Missing required query parameter(s): imagesSources and model are required.' });
        return;
      }
      if (model === 'clip') {
        try {
            const descriptions = await ReplicateImageDescriber.describeImages(imagesSource);
            res.json(descriptions);
            req.log.logger.debug(`Response sent with descriptions:`);
        } catch (error) {
          res.status(500).json({ error: 'Error fetching descriptions for the provided images' });
        }
      }
    });

    // Get Alt Text for (one) image
    apiRouter.get(['/accessibility/getImageDescription', '/v1/accessibility/getImageDescription'], cors(), async (req, res) => {
      req.log.startTime = Date.now();
      req.log.logger.info(`${req.log.startTime} Request received`);
      req.log(req, res);

      const imageSource = req.query.imageSource;
      const model = req.query.model;
      req.log.logger.debug(`Model: ${model}, imageSource: ${imageSource}`);

      if (!imageSource || !model) {
        res.status(400).json({ error: 'Missing required query parameter(s): imageSource and model are required.' });
        return;
      }
      if (model === 'clip') {
        try {
            req.log.logger.debug(`Asking replicate-image-describer module to describe ${imageSource}`);
            const descriptions = await ReplicateImageDescriber.describeImage(imageSource, req.log);
            req.log.logger.debug(`replicate-image-describer module returned ${descriptions}`);
            res.json(descriptions);
        } catch (error) {
          req.log.logger.debug(`Error trying to get a description from the replicate-image-describer module: ${error}`);
          res.status(500).json({ error: 'Error fetching description for the provided image' });
        }
      }
    });

    // API 404 error handler
    apiRouter.use((req, res, next) => {
      res.status(404).json({ error: 'Endpoint not found' });
      next();
    });

    serverLogger.logger.info('APIRoutes loaded.');
  }

  setImmediate(() => { serverLogger.logger.debug('[MODULE] api/v1/routes/api loaded'); });

  // Module exports
  return {
    loadAPIRoutes,
    apiRouter
  };
};