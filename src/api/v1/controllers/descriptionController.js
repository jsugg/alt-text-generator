const { isValidUrl } = require('../../../utils/urlValidator');

/**
 * Handles requests to generate alt-text descriptions for images.
 */
class DescriptionController {
  /**
   * @param {object} deps
   * @param {object} deps.imageDescriberFactory - ImageDescriberFactory instance
   * @param {object} deps.logger - pino logger instance
   */
  constructor({ imageDescriberFactory, logger }) {
    this.factory = imageDescriberFactory;
    this.logger = logger;
    this.describe = this.describe.bind(this);
  }

  /**
   * @swagger
   * /api/accessibility/description:
   *   get:
   *     summary: Returns a description for a given image
   *     description: Takes an image URL and sends it to the selected AI model to generate an alt-text description.
   *     parameters:
   *       - name: image_source
   *         in: query
   *         description: URLEncoded address of the image.
   *         required: true
   *         schema:
   *           type: string
   *           example: https%3A%2F%2Fexample.com%2Fphoto.jpg
   *       - name: model
   *         in: query
   *         description: The AI model to use. Available models are listed at /api/health.
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
   *                     example: https://example.com/photo.jpg
   *       400:
   *         description: Missing or invalid parameters, or unsupported model
   *       500:
   *         description: Server error
   */
  async describe(req, res) {
    const { image_source: rawImageSource, model } = req.query;

    if (!rawImageSource || !model) {
      return res.status(400).json({
        error: 'Missing required query parameters: image_source and model',
      });
    }

    let imageSource = decodeURIComponent(rawImageSource);
    // Strip query strings from the image URL itself
    if (imageSource.includes('?')) [imageSource] = imageSource.split('?');

    if (!isValidUrl(imageSource)) {
      return res.status(400).json({ error: 'Invalid image_source URL' });
    }

    this.logger.info({ model, imageSource }, 'Description request');

    try {
      const describer = this.factory.get(model);
      const result = await describer.describeImage(imageSource);
      return res.json([result]);
    } catch (error) {
      // factory.get() throws a user-facing error for unknown models
      if (error.message.startsWith('Unknown model')) {
        return res.status(400).json({ error: error.message });
      }
      this.logger.error({ error }, 'Error generating description');
      return res.status(500).json({ error: 'Error fetching description for the provided image' });
    }
  }
}

module.exports = DescriptionController;
