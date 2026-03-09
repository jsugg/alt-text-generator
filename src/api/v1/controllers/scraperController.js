const { isValidUrl } = require('../../../utils/urlValidator');

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
   *     parameters:
   *       - name: url
   *         in: query
   *         description: URLEncoded address of the target website.
   *         required: true
   *         schema:
   *           type: string
   *           example: https%3A%2F%2Fneymarques.com%2F
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
   *       500:
   *         description: Server error
   */
  async getImages(req, res) {
    const requestLogger = req.log ?? this.logger;
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Missing required query parameter: url' });
    }

    const decodedUrl = decodeURIComponent(url);

    if (!isValidUrl(decodedUrl)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    try {
      const result = await this.scraperService.getImages(decodedUrl);
      return res.json(result);
    } catch (error) {
      requestLogger.error({ err: error, url: decodedUrl }, 'Error scraping images');
      return res.status(500).json({ error: 'Error fetching images from the provided URL' });
    }
  }
}

module.exports = ScraperController;
