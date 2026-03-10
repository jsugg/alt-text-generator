const { isValidUrl } = require('../../../utils/urlValidator');
const { normalizeImageSource } = require('../../../utils/imageSource');

/**
 * Handles requests to generate alt-text descriptions for images.
 */
class DescriptionController {
  /**
   * @param {object} deps
   * @param {object} deps.imageDescriberFactory - ImageDescriberFactory instance
   * @param {object} deps.pageDescriptionService - PageDescriptionService instance
   * @param {object} deps.logger - pino logger instance
   */
  constructor({ imageDescriberFactory, pageDescriptionService, logger }) {
    this.factory = imageDescriberFactory;
    this.pageDescriptionService = pageDescriptionService;
    this.logger = logger;
    this.describe = this.describe.bind(this);
    this.describePage = this.describePage.bind(this);
  }

  /**
   * @swagger
   * /api/accessibility/description:
   *   get:
   *     summary: Returns a description for a given image
   *     description: Takes an image URL and sends it to the selected AI model
   *       to generate an alt-text description.
   *     parameters:
   *       - name: image_source
   *         in: query
   *         description: URLEncoded address of the image.
   *         required: true
   *         schema:
   *           type: string
   *           example: https%3A%2F%2Fdeveloper.chrome.com%2Fstatic%2Fimages%2Fai-homepage-card.png
   *       - name: model
   *         in: query
   *         description: The AI model to use, for example `clip` or `azure`.
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
   *                     example: https://developer.chrome.com/static/images/ai-homepage-card.png
   *       400:
   *         description: Missing or invalid parameters, or unsupported model
   *       500:
   *         description: Server error
   */
  async describe(req, res) {
    const requestLogger = req.log ?? this.logger;
    const { image_source: rawImageSource, model } = req.query;

    if (!rawImageSource || !model) {
      return res.status(400).json({
        error: 'Missing required query parameters: image_source and model',
      });
    }

    const imageSource = normalizeImageSource(rawImageSource);

    if (!isValidUrl(imageSource)) {
      return res.status(400).json({ error: 'Invalid image_source URL' });
    }

    requestLogger.info({ model, imageSource }, 'Description request');

    try {
      const describer = this.factory.get(model);
      const result = await describer.describeImage(imageSource);
      return res.json([result]);
    } catch (error) {
      // factory.get() throws a user-facing error for unknown models
      if (error.message.startsWith('Unknown model')) {
        return res.status(400).json({ error: error.message });
      }
      requestLogger.error({ err: error, model, imageSource }, 'Error generating description');
      return res.status(500).json({
        error: 'Error fetching description for the provided image',
      });
    }
  }

  /**
   * @swagger
   * /api/accessibility/descriptions:
   *   get:
   *     summary: Returns descriptions for images found on a page
   *     description: Scrapes a website, preserves duplicate image entries in page
   *       order, and reuses a single prediction per unique image URL.
   *     parameters:
   *       - name: url
   *         in: query
   *         description: URLEncoded address of the target website.
   *         required: true
   *         schema:
   *           type: string
   *           example: https%3A%2F%2Fdeveloper.chrome.com%2F
   *       - name: model
   *         in: query
   *         description: The AI model to use, for example `clip` or `azure`.
   *         required: true
   *         schema:
   *           type: string
   *           example: clip
   *     responses:
   *       200:
   *         description: OK
   *       400:
   *         description: Missing or invalid parameters, or unsupported model
   *       500:
   *         description: Server error
   */
  async describePage(req, res) {
    const requestLogger = req.log ?? this.logger;
    const { url: rawPageUrl, model } = req.query;

    if (!rawPageUrl || !model) {
      return res.status(400).json({
        error: 'Missing required query parameters: url and model',
      });
    }

    const pageUrl = decodeURIComponent(rawPageUrl);

    if (!isValidUrl(pageUrl)) {
      return res.status(400).json({ error: 'Invalid url parameter' });
    }

    requestLogger.info({ model, pageUrl }, 'Page description request');

    try {
      const result = await this.pageDescriptionService.describePage({
        pageUrl,
        model,
      });
      return res.json(result);
    } catch (error) {
      if (error.message.startsWith('Unknown model')) {
        return res.status(400).json({ error: error.message });
      }

      requestLogger.error({ err: error, model, pageUrl }, 'Error generating page descriptions');
      return res.status(500).json({
        error: 'Error fetching descriptions for the provided page',
      });
    }
  }
}

module.exports = DescriptionController;
