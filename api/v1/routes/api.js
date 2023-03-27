"use strict"
const express = require('express');
const apiRouter = express.Router();
const appPath = require('app-root-path').toString();
const WebScrapper = require(`${appPath}/utils/webscrapper`);
const AzureImageDescriber = require(`${appPath}/utils/azure-image-describer`);
const ReplicateImageDescriber = require(`${appPath}/utils/replicate-image-describer`);
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

    // getImages from external URL
    apiRouter.get(['/webScrapper/getImages', '/v1/webScrapper/getImages'], cors(), async (req, res) => {
      httpServerLogger.startTime = Date.now();
      httpServerLogger.logger.info(`${httpServerLogger.startTime} Request received`);
      httpServerLogger(req, res);
      
      const requestUrl = req.query.url;
      serverLogger.debug(`Queried URL: ${requestUrl}`);

      if (!requestUrl) {
        res.status(400).json({ error: 'Missing required query parameter: url' });
        return;
      }
      try {
        const images = await WebScrapper.getImages(requestUrl);
        res.json(images);
        serverLogger.debug(`Response sent with images: ${JSON.stringify(images)}`);
      } catch (error) {
        res.status(500).json({ error: 'Error fetching images from the provided URL' });
      }
    });

    // Get Alt Text from images
    apiRouter.get(['/accessibility/getImageDescriptions', '/v1/accessibility/getImageDescriptions'], cors(), async (req, res) => {
      httpServerLogger.startTime = Date.now();
      httpServerLogger.logger.info(`${httpServerLogger.startTime} Request received`);
      httpServerLogger(req, res);

      const imagesSource = req.query.imagesSource;
      const model = req.query.model;
      serverLogger.debug(`Model: ${model}, imagesSource: ${imagesSource}`);

      if (!imagesSource || !model) {
        res.status(400).json({ error: 'Missing required query parameter(s): imagesSources and model are required.' });
        return;
      }
      if (model === 'clip') {
        try {
            
            const descriptions = await ReplicateImageDescriber.describeImages(imagesSource);
            res.json(descriptions);
            //serverLogger.debug(`Response sent with descriptions: ${JSON.stringify(descriptions.map( images => images['title']))}`);
        } catch (error) {
          res.status(500).json({ error: 'Error fetching descriptions for the provided images' });
        }
      }
    });

    // Get Alt Text from (one) image
    apiRouter.get(['/accessibility/getImageDescription', '/v1/accessibility/getImageDescription'], cors(), async (req, res) => {
      httpServerLogger.startTime = Date.now();
      httpServerLogger.logger.info(`${httpServerLogger.startTime} Request received`);
      httpServerLogger(req, res);

      const imageSource = req.query.imageSource;
      const model = req.query.model;
      serverLogger.debug(`Model: ${model}, imageSource: ${imageSource}`);

      if (!imageSource || !model) {
        res.status(400).json({ error: 'Missing required query parameter(s): imageSource and model are required.' });
        return;
      }
      if (model === 'clip') {
        try {
            const descriptions = await ReplicateImageDescriber.describeImage(imageSource);
            res.json(descriptions);
        } catch (error) {
          res.status(500).json({ error: 'Error fetching description for the provided image' });
        }
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