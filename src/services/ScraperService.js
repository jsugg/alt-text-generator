const path = require('path');
const cheerio = require('cheerio');

/**
 * Scrapes images from a given website URL.
 *
 * Dependencies are injected via the constructor to keep this class testable.
 */
class ScraperService {
  /**
   * @param {object} deps
   * @param {object} deps.logger - pino logger instance
   * @param {object} deps.httpClient - axios-compatible HTTP client
   * @param {object} deps.requestOptions - bounded axios request options
   */
  constructor({ logger, httpClient, requestOptions = {} }) {
    this.logger = logger;
    this.httpClient = httpClient;
    this.requestOptions = requestOptions;
  }

  static IMAGE_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
  ]);

  static LAZY_LOAD_ATTRS = new Set([
    'data-src',
    'data-original-src',
    'data-lazy-src',
    'data-srcset',
    'src',
  ]);

  /**
   * Returns true if the URL points to an image based on its file extension.
   * @param {string} imageUrl
   * @returns {boolean}
   */
  static isImage(imageUrl) {
    const cleanUrl = imageUrl.toLowerCase().split('?')[0];
    const ext = path.extname(cleanUrl);
    return ScraperService.IMAGE_EXTENSIONS.has(ext);
  }

  /**
   * Fetches raw HTML from the target URL.
   * Throws on network error so callers can handle it properly.
   * @param {string} targetUrl
   * @returns {Promise<string>}
   */
  async fetchHtml(targetUrl) {
    const response = await this.httpClient.get(targetUrl, {
      headers: { Origin: targetUrl },
      timeout: this.requestOptions.timeout,
      maxRedirects: this.requestOptions.maxRedirects,
      maxContentLength: this.requestOptions.maxContentLength,
      maxBodyLength: this.requestOptions.maxContentLength,
      responseType: 'text',
    });
    return response.data;
  }

  /**
   * Extracts image source URLs from HTML content.
   * @param {string} html
   * @param {string} targetUrl - Used to resolve relative URLs
   * @returns {{ imageSources: string[] }}
   */
  extractImageSources(html, targetUrl) {
    const $ = cheerio.load(html);
    const images = [];

    $('img').each((index, img) => {
      const attrs = $(img)[0].attribs;
      let src = null;

      // Prefer known lazy-load attributes first
      const lazyAttr = Array.from(ScraperService.LAZY_LOAD_ATTRS).find((attr) => {
        const candidate = attrs[attr];
        return candidate && ScraperService.isImage(candidate);
      });
      if (lazyAttr) src = attrs[lazyAttr];

      // Fall back to any other attribute that looks like an image URL
      if (!src) {
        const fallbackAttr = Object.keys(attrs)
          .filter((attr) => !ScraperService.LAZY_LOAD_ATTRS.has(attr))
          .find((attr) => ScraperService.isImage(attrs[attr]));
        if (fallbackAttr) src = attrs[fallbackAttr];
      }

      if (src) {
        // Strip query strings
        if (src.includes('?')) [src] = src.split('?');

        // Resolve to absolute URL
        try {
          src = src.startsWith('http://') || src.startsWith('https://')
            ? new URL(src).href
            : new URL(src, targetUrl).href;
          images.push(src);
        } catch {
          this.logger.warn({ src }, 'Could not resolve image URL, skipping');
        }
      }
    });

    return { imageSources: images };
  }

  /**
   * Scrapes images from a website.
   * Throws on failure — callers are responsible for error handling.
   * @param {string} targetUrl
   * @returns {Promise<{ imageSources: string[] }>}
   */
  async getImages(targetUrl) {
    const html = await this.fetchHtml(targetUrl);
    const result = this.extractImageSources(html, targetUrl);
    this.logger.info({ count: result.imageSources.length }, 'Images scraped');
    return result;
  }
}

module.exports = ScraperService;
