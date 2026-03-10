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
   * Image-specific failures can be skipped when the provider exposes an
   * explicit skip policy for page-level best-effort processing.
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
    const filteredImageSources = typeof describer.filterSupportedImageSources === 'function'
      ? describer.filterSupportedImageSources(imageSources)
      : imageSources;
    const descriptionPromises = new Map();

    filteredImageSources.forEach((imageSource) => {
      if (!descriptionPromises.has(imageSource)) {
        descriptionPromises.set(imageSource, describer.describeImage(imageSource));
      }
    });

    const settledDescriptions = new Map(
      await Promise.all(
        [...descriptionPromises.entries()].map(async ([imageSource, descriptionPromise]) => {
          try {
            return [imageSource, { status: 'fulfilled', value: await descriptionPromise }];
          } catch (error) {
            return [imageSource, { status: 'rejected', reason: error }];
          }
        }),
      ),
    );
    const successfulImageSources = [];
    const descriptions = [];

    filteredImageSources.forEach((imageSource) => {
      const result = settledDescriptions.get(imageSource);

      if (result?.status === 'fulfilled') {
        successfulImageSources.push(imageSource);
        descriptions.push(result.value);
        return;
      }

      const shouldSkipDescriptionError = typeof describer.shouldSkipDescriptionError === 'function'
        && describer.shouldSkipDescriptionError(result?.reason);

      if (shouldSkipDescriptionError) {
        return;
      }

      throw result?.reason;
    });

    return {
      pageUrl,
      model,
      totalImages: successfulImageSources.length,
      uniqueImages: new Set(successfulImageSources).size,
      descriptions,
    };
  }
}

module.exports = PageDescriptionService;
