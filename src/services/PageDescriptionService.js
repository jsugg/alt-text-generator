/**
 * Orchestrates page scraping and image description generation.
 *
 * Duplicate image URLs are preserved in the output order, but each unique
 * image URL is only described once per request.
 */
class PageDescriptionService {
  /**
   * @param {object} deps
   * @param {object} deps.scraperService - ScraperService instance
   * @param {object} deps.imageDescriberFactory - ImageDescriberFactory instance
   */
  constructor({ scraperService, imageDescriberFactory }) {
    this.scraperService = scraperService;
    this.imageDescriberFactory = imageDescriberFactory;
  }

  /**
   * Describes the images found on a page while preserving their original order.
   *
   * @param {object} params
   * @param {string} params.pageUrl
   * @param {string} params.model
   * @returns {Promise<{
   *   pageUrl: string,
   *   model: string,
   *   totalImages: number,
   *   uniqueImages: number,
   *   descriptions: Array<{ description: string, imageUrl: string }>
   * }>}
   */
  async describePage({ pageUrl, model }) {
    const describer = this.imageDescriberFactory.get(model);
    const { imageSources } = await this.scraperService.getImages(pageUrl);
    const descriptionCache = new Map();

    const descriptions = await Promise.all(imageSources.map((imageSource) => {
      if (!descriptionCache.has(imageSource)) {
        descriptionCache.set(imageSource, describer.describeImage(imageSource));
      }

      return descriptionCache.get(imageSource);
    }));

    return {
      pageUrl,
      model,
      totalImages: imageSources.length,
      uniqueImages: descriptionCache.size,
      descriptions,
    };
  }
}

module.exports = PageDescriptionService;
