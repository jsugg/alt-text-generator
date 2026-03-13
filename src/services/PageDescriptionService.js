const toPositiveInteger = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const mapWithConcurrencyLimit = async (items, limit, mapper) => {
  if (items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  const createWorker = async () => {
    const currentIndex = nextIndex;
    nextIndex += 1;

    if (currentIndex >= items.length) {
      return;
    }

    results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    await createWorker();
  };
  const workers = Array.from({ length: workerCount }, () => createWorker());

  await Promise.all(workers);
  return results;
};

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
   * @param {number} [deps.concurrency] - max concurrent provider calls for page descriptions
   */
  constructor({ scraperService, imageDescriberFactory, concurrency = 3 }) {
    this.scraperService = scraperService;
    this.imageDescriberFactory = imageDescriberFactory;
    this.concurrency = toPositiveInteger(concurrency, 3);
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
    const uniqueImageSources = [...new Set(filteredImageSources)];

    const settledDescriptions = new Map(
      await mapWithConcurrencyLimit(
        uniqueImageSources,
        this.concurrency,
        async (imageSource) => {
          try {
            return [imageSource, { status: 'fulfilled', value: await describer.describeImage(imageSource) }];
          } catch (error) {
            return [imageSource, { status: 'rejected', reason: error }];
          }
        },
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
