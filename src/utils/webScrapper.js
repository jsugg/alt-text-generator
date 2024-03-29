const axios = require('axios');
const cheerio = require('cheerio');
require('url');
/**
 * A class used for scraping images from a given website.
 * @class
 */
class WebScrapper {
  static log;

  /**
   * Set up the logger for the WebScrapper class.
   *
   * @param {Object} options - Optional parameters for the function.
   * @param {Object} options.logger - The logger to be used for logging.
   * @return {undefined} This function does not return anything.
   */
  static use({ logger } = {}) {
    WebScrapper.log = logger || this.log;
  }

  /**
   * Checks if a given URL is an image.
   * @static
   * @param {string} imageUrl - The URL to check.
   * @returns {boolean} - True if the URL is an image, false otherwise.
   */
  static isImage(imageUrl) {
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);
    return imageExtensions.has(imageUrl.toLowerCase().split('?')[0].slice(-4)) || imageExtensions.has(imageUrl.toLowerCase().split('?')[0].slice(-3));
  }

  /**
   * Fetches the HTML content of a website.
   * @static
   * @param {string} targetUrl - The URL of the website.
   * @returns {Promise<string|null>} - The HTML content of the website,
   * or null if there was an error.
   */
  static async fetchHtml(targetUrl) {
    try {
      const response = await axios.get(targetUrl, {
        headers: {
          Origin: targetUrl,
        },
      });
      return response.data;
    } catch (error) {
      WebScrapper.log.logger.error('Error fetching the website:', error);
      return null;
    }
  }

  /**
   * Extracts the image sources from the HTML content.
   * @static
   * @param {string} html - The HTML content of the website.
   * @param {string} targetUrl - The URL of the website.
   * @returns {object} - An object containing an array of image source URLs.
   */
  static extractImageSources(html, targetUrl) {
    const $ = cheerio.load(html);
    const images = [];
    const possibleAttributes = new Set([
      'data-src',
      'data-original-src',
      'data-lazy-src',
      'data-srcset',
      'src',
    ]);

    $('img').each((index, img) => {
      const imgAttributes = $(img)[0].attribs;

      let src = Array.from(possibleAttributes).find((attr) => {
        const candidateSrc = imgAttributes[attr];
        return candidateSrc && WebScrapper.isImage(candidateSrc);
      });
      if (src) src = imgAttributes[src];

      if (!src) {
        const candidateSrc = Object.keys(imgAttributes)
          .filter((attr) => !possibleAttributes.has(attr))
          .find((attr) => WebScrapper.isImage(imgAttributes[attr]));
        if (candidateSrc) {
          src = imgAttributes[candidateSrc];
        }
      }

      if (src) {
        if (src.includes('?')) {
          [src] = src.split('?');
        }
        if (src.startsWith('http://') || src.startsWith('https://')) {
          src = new URL(src).href;
        } else {
          src = new URL(src, targetUrl).href;
        }
        // const resolvedUrl = new URL(src, targetUrl).href;
        images.push(src);
      }
    });

    return { imageSources: images };
  }

  /**
   * Scrapes images from a given website.
   * @static
   * @param {string} targetUrl - The URL of the website.
   * @returns {Promise<object|null>} - An object containing an array of image
   * source URLs, or null if there was an error.
   */
  static async getImages(targetUrl) {
    const html = await WebScrapper.fetchHtml(targetUrl);
    if (!html) return null;
    const imageSources = WebScrapper.extractImageSources(html, targetUrl);
    WebScrapper.log.logger.info('Images:', imageSources.imageSources);
    return imageSources;
  }
}

module.exports = WebScrapper;
