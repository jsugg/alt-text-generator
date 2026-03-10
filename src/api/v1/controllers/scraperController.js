const { isValidUrl } = require('../../../utils/urlValidator');
const { ApiError } = require('../../../errors/ApiError');

/**
 * Handles requests to scrape images from a website.
 */
class ScraperController {
  /**
   * @param {object} deps
   * @param {object} deps.scraperService - ScraperService instance
   * @param {object} deps.logger - pino logger instance
   */
  constructor({ scraperService, logger }) {
    this.scraperService = scraperService;
    this.logger = logger;
    // bind so the method can be passed directly as an Express handler
    this.getImages = this.getImages.bind(this);
  }

  /**
   * @swagger
   * /api/scraper/images:
   *   get:
   *     summary: Returns the list of images found in a website
   *     description: Visits the website, selects img elements, and returns their src URLs as JSON.
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
   *                   items:
   *                     type: string
   *       400:
   *         description: Missing or invalid url parameter
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
  async getImages(req, res, next) {
    const { url } = req.query;

    if (!url) {
      return next(ApiError.badRequest({
        message: 'Missing required query parameter: url',
        code: 'QUERY_VALIDATION_ERROR',
        details: [{ field: 'url', issue: 'required' }],
      }));
    }

    const decodedUrl = decodeURIComponent(url);

    if (!isValidUrl(decodedUrl)) {
      return next(ApiError.badRequest({
        message: 'Invalid URL format',
        code: 'INVALID_PAGE_URL',
        details: [{ field: 'url', issue: 'invalid_url' }],
      }));
    }

    try {
      const result = await this.scraperService.getImages(decodedUrl);
      return res.json(result);
    } catch (error) {
      return next(ApiError.internal({
        message: 'Error fetching images from the provided URL',
        code: 'SCRAPE_FETCH_FAILED',
        cause: error,
      }));
    }
  }
}

module.exports = ScraperController;
