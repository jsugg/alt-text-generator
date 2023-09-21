const express = require('express');
const { URL } = require('url');
const cors = require('cors');

const WebScrapper = require('../../../utils/webScrapper');
const ReplicateImageDescriber = require('../../../utils/ReplicateImageDescriber');
// const AzureImageDescriber = require('../../../utils/azure-image-describer');

const apiRouter = express.Router();

/**
 * This code snippet exports an Express router and a function to load API routes.
 * It sets up routes for a ping endpoint, an endpoint to scrape images from a website,
 * and an endpoint to get descriptions for images using an AI model. It also includes
 * error handling for invalid endpoints.
 *
 * Example Usage:
 * const serverLogger = require('./serverLogger');
 * const apiRoutes = require('./apiRoutes');
 *
 * const logger = serverLogger();
 * const { loadAPIRoutes, apiRouter } = apiRoutes(logger);
 *
 * loadAPIRoutes(logger);
 *
 * app.use('/api', apiRouter);
 *
 * Inputs:
 * - serverLogger: A logger object used for logging server events.
 *
 * Outputs:
 * - The module exports the loadAPIRoutes function and the Express router.
 */
/* eslint-disable max-len */

module.exports = (serverLogger) => {
  ReplicateImageDescriber.use({ logger: serverLogger });
  WebScrapper.use({ logger: serverLogger });

  apiRouter.use((req, res, next) => {
    req.log = serverLogger;
    next();
  });

  function validateUrl(url) {
    try {
      serverLogger.logger.debug(`Validating URL...url: ${url}`);
      const parsedUrl = new URL(url);
      serverLogger.logger.debug(`Validating URL...parsedUrl: ${parsedUrl}`);
      return Boolean(parsedUrl);
    } catch (error) {
      return false;
    }
  }

  function loadAPIRoutes(logger) {
    logger.logger.info('Loading APIRoutes...');

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
     *         description: Server error
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
     *         description: URLEncoded address of the website containing the image hrefs to be scrapped (see https://www.urlencoder.org/).
     *         required: true
     *         schema:
     *           type: string
     *           example: https%3A%2F%2Fneymarques.com%2Fsimple-lofi-hip-hop-music-sleep-relax-study%2F
     *     responses:
     *       200:
     *         description: OK
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 imageSources:
     *                   type: array
     *                   example: ["https://cdn.statically.io/img/neymarques.com/wp-content/uploads/2022/11/Ney-Simple-LoFi-1024x1024.jpeg","https://cdn.statically.io/img/neymarques.com/wp-content/uploads/2022/11/Spotify-Emblema-e1668647961321-150x150.png"]
     *       500:
     *         description: Server error
     */
    apiRouter.get(
      ['/scrapper/images', '/v1/scrapper/images'],
      cors(),
      async (req, res) => {
        req.log.startTime = Date.now();
        req.log.logger.info(`${req.log.startTime} Request received`);
        req.log(req, res);

        const requestUrl = req.query.url;
        req.log.logger.debug(`Queried URL: ${requestUrl}`);

        if (!requestUrl || !validateUrl(decodeURIComponent(requestUrl))) {
          res.status(400).json({
            error: 'Missing or invalid required query parameter: url',
          });
          return;
        }
        const decodedUrl = decodeURIComponent(requestUrl);
        try {
          const images = await WebScrapper.getImages(decodedUrl);
          res.json(images);
          req.log.logger.debug(
            `Response sent with images: ${images.toString()}`,
          );
        } catch (error) {
          res
            .status(500)
            .json({ error: 'Error fetching images from the provided URL' });
        }
      },
    );

    /**
     * @swagger
     * /api/accessibility/description:
     *   get:
     *     summary: Returns a description for a given image.
     *     description: This endpoint takes an image URL, fetches its content, converts it into a data URL, and sends it to an AI service that returns a description for it.
     *     parameters:
     *       - name: image_source
     *         in: query
     *         description: URLEncoded address of the image (see https://www.urlencoder.org/).
     *         required: true
     *         schema:
     *           type: string
     *           example: https%3A%2F%2Fneymarques.com%2Fwp-content%2Fuploads%2F2022%2F12%2FIMG_2752-2.jpg
     *       - name: model
     *         in: query
     *         description: The AI model used to generate a description for the image. Only 'clip' is currently available.
     *         required: true
     *         schema:
     *           type: string
     *           example: clip
     *     responses:
     *       200:
     *         description: OK
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
     *         description: Server error
     */
    apiRouter.get(
      ['/accessibility/description', '/v1/accessibility/description'],
      cors(),
      async (req, res) => {
        req.log.startTime = Date.now();
        req.log.logger.info(`${req.log.startTime} Request received`);
        req.log(req, res);
        const imageSource = {
          imagesSource: [decodeURIComponent(req.query.image_source)],
        };
        const { model } = req.query;
        req.log.logger.debug(
          `Model: ${model}, imageSource: ${JSON.stringify(imageSource)}`,
        );

        if (
          !imageSource
          || !model
          || !validateUrl(imageSource.imagesSource[0])
        ) {
          res.status(400).json({
            error:
              'Missing or invalid required query parameter(s): image_source and model are required.',
          });
          return;
        }
        if (model === 'clip') {
          try {
            req.log.logger.debug('Using Replicate image-to-text module...');
            const descriptions = await ReplicateImageDescriber.describeImage(
              imageSource,
            );
            req.log.logger.info('Response sent with alt text.');
            res.json(descriptions);
          } catch (error) {
            req.log.logger.debug(
              `Error trying to get a description from the replicate-image-describer module: ${error}`,
            );
            res.status(500).json({
              error: 'Error fetching description for the provided image',
            });
          }
        }
      },
    );

    // API 404 error handler
    apiRouter.use((req, res, next) => {
      res.status(404).json({ error: 'Endpoint not found' });
      next();
    });

    serverLogger.logger.info('APIRoutes loaded.');
  }

  setImmediate(() => {
    serverLogger.logger.debug('[MODULE] api/v1/routes/api loaded');
  });

  // Module exports
  return {
    loadAPIRoutes,
    apiRouter,
  };
};
