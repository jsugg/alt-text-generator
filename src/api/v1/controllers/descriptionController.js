const { isValidUrl } = require('../../../utils/urlValidator');
const { normalizeImageSource } = require('../../../utils/imageSource');
const { ApiError } = require('../../../errors/ApiError');

const buildRequiredQueryDetails = (fields) => fields.map((field) => ({
  field,
  issue: 'required',
}));

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
   *     security:
   *       - bearerAuth: []
   *       - apiKeyAuth: []
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
   *         description: The AI model to use, for example `clip`, `azure`,
   *           `ollama`, `huggingface`, `openai`, `openrouter`, or `together`.
   *         required: true
   *         schema:
   *           type: string
   *           enum:
   *             - clip
   *             - azure
   *             - ollama
   *             - huggingface
   *             - openai
   *             - openrouter
   *             - together
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
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       401:
   *         description: Missing or invalid API authentication credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   */
  async describe(req, res, next) {
    const requestLogger = req.log ?? this.logger;
    const { image_source: rawImageSource, model } = req.query;
    const missingFields = ['image_source', 'model'].filter((field) => !req.query[field]);

    if (missingFields.length > 0) {
      return next(ApiError.badRequest({
        message: 'Missing required query parameters: image_source and model',
        code: 'QUERY_VALIDATION_ERROR',
        details: buildRequiredQueryDetails(missingFields),
      }));
    }

    const imageSource = normalizeImageSource(rawImageSource);

    if (!isValidUrl(imageSource)) {
      return next(ApiError.badRequest({
        message: 'Invalid image_source URL',
        code: 'INVALID_IMAGE_SOURCE_URL',
        details: [{ field: 'image_source', issue: 'invalid_url' }],
      }));
    }

    requestLogger.info({ model, imageSource }, 'Description request');

    try {
      const describer = this.factory.get(model);
      const result = await describer.describeImage(imageSource);
      return res.json([result]);
    } catch (error) {
      // factory.get() throws a user-facing error for unknown models
      if (error.message.startsWith('Unknown model')) {
        return next(ApiError.badRequest({
          message: error.message,
          code: 'UNKNOWN_MODEL',
          details: [{ field: 'model', issue: 'unsupported_value' }],
        }));
      }

      return next(ApiError.internal({
        message: 'Error fetching description for the provided image',
        code: 'DESCRIPTION_FETCH_FAILED',
        cause: error,
      }));
    }
  }

  /**
   * @swagger
   * /api/accessibility/descriptions:
   *   get:
   *     summary: Returns descriptions for images found on a page
   *     description: Scrapes a website, preserves duplicate image entries in page
   *       order, and reuses a single prediction per unique image URL.
   *     security:
   *       - bearerAuth: []
   *       - apiKeyAuth: []
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
   *         description: The AI model to use, for example `clip`, `azure`,
   *           `ollama`, `huggingface`, `openai`, `openrouter`, or `together`.
   *         required: true
   *         schema:
   *           type: string
   *           enum:
   *             - clip
   *             - azure
   *             - ollama
   *             - huggingface
   *             - openai
   *             - openrouter
   *             - together
   *           example: clip
   *     responses:
   *       200:
   *         description: OK
   *       400:
   *         description: Missing or invalid parameters, or unsupported model
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       401:
   *         description: Missing or invalid API authentication credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   */
  async describePage(req, res, next) {
    const requestLogger = req.log ?? this.logger;
    const { url: rawPageUrl, model } = req.query;
    const missingFields = ['url', 'model'].filter((field) => !req.query[field]);

    if (missingFields.length > 0) {
      return next(ApiError.badRequest({
        message: 'Missing required query parameters: url and model',
        code: 'QUERY_VALIDATION_ERROR',
        details: buildRequiredQueryDetails(missingFields),
      }));
    }

    const pageUrl = decodeURIComponent(rawPageUrl);

    if (!isValidUrl(pageUrl)) {
      return next(ApiError.badRequest({
        message: 'Invalid url parameter',
        code: 'INVALID_PAGE_URL',
        details: [{ field: 'url', issue: 'invalid_url' }],
      }));
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
        return next(ApiError.badRequest({
          message: error.message,
          code: 'UNKNOWN_MODEL',
          details: [{ field: 'model', issue: 'unsupported_value' }],
        }));
      }

      return next(ApiError.internal({
        message: 'Error fetching descriptions for the provided page',
        code: 'PAGE_DESCRIPTION_FETCH_FAILED',
        cause: error,
      }));
    }
  }
}

module.exports = DescriptionController;
