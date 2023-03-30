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

    /**
     * @swagger
     * /api/ping:
     *   get:
     *     summary: Check if the API is available
     *     responses:
     *       200:
     *         description: API is online and listening
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: pong
     *       500:
     *         description: Some server error
     */
    apiRouter.get(['/ping', '/v1/ping'], (req, res) => {
      req.log.startTime = Date.now();
      req.log.logger.info(`${req.log.startTime} Request received`);
      req.log(req, res);
      res.status(200).send('pong');
    });

    /**
     * @swagger
     * /api/scrapper/images:
     *   get:
     *     summary: Returns the list of images found in a website
     *     description: This endpoint visits the website, selects the <img> elements, extracts its href attribute, and returns them in JSON format.
     *     parameters:
     *       - name: url
     *         in: query
     *         description: URL of the website containing the image hrefs to be scrapped
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 imageSources:
     *                   type: array
     *                   example: ["https://cdn.statically.io/img/neymarques.com/wp-content/uploads/2022/11/Ney-Simple-LoFi-1024x1024.jpeg","https://cdn.statically.io/img/neymarques.com/wp-content/uploads/2022/11/Spotify-Emblema-e1668647961321-150x150.png"]
     *       500:
     *         description: Some server error
     */
    apiRouter.get(['/scrapper/images', '/v1/scrapper/images'], cors(), async (req, res) => {
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

    /**
     * @swagger
     * /api/accessibility/description:
     *   get:
     *     summary: Returns a description for a given image
     *     description: This endpoint takes an image URL, fetches its content, converts it into a data URL, and sends it to an AI service that returns a description for it.
     *     parameters:
     *       - name: image_source
     *         in: query
     *         description: URL of the image to be described
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   description:
     *                     type: string
     *                     example: A man with glasses is playing a violin.
     *                   imageUrl:
     *                     type: string
     *                     example: https://neymarques.com/wp-content/uploads/2022/12/IMG_2752-2.jpg
     *       500:
     *         description: Some server error
     */
    apiRouter.get(['/accessibility/description', '/v1/accessibility/description'], cors(), async (req, res) => {
      req.log.startTime = Date.now();
      req.log.logger.info(`${req.log.startTime} Request received`);
      req.log(req, res);

      const imageSource = req.query.image_source;
      const model = req.query.model;
      req.log.logger.debug(`Model: ${model}, imageSource: ${imageSource}`);

      if (!imageSource || !model) {
        res.status(400).json({ error: 'Missing required query parameter(s): image_source and model are required.' });
        return;
      }
      if (model === 'clip') {
        try {
            const descriptions = await ReplicateImageDescriber.describeImage(imageSource, req.log);
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

    serverLogger.logger.info('APIRoutes loaded.');
  }

  setImmediate(() => { serverLogger.logger.debug('[MODULE] api/v1/routes/api loaded'); });

  // Module exports
  return {
    loadAPIRoutes,
    apiRouter
  };
};