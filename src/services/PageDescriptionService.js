/**
 * @typedef {{ description: string, imageUrl: string }} ImageDescription
 */

/**
 * @typedef {object} ProviderJob
 * @property {string} status
 * @property {string} providerJobId
 * @property {ImageDescription} [result]
 * @property {unknown} [error]
 */

/**
 * @typedef {{ status: 'fulfilled', value: ImageDescription } | { status: 'rejected', reason: unknown }} SettledDescription
 */

/**
 * A duck-typed image describer. Capability methods beyond describeImage are
 * probed with typeof checks before use.
 * @typedef {object} Describer
 * @property {(imageSource: string) => Promise<ImageDescription>} describeImage
 * @property {(imageSources: string[]) => string[]} [filterSupportedImageSources]
 * @property {(reason: unknown) => boolean} [shouldSkipDescriptionError]
 * @property {(imageSource: string) => Promise<ProviderJob>} [createDescriptionJob]
 * @property {(providerJobId: string, imageSource: string) => Promise<ProviderJob>} [getDescriptionJob]
 */

/**
 * A describer that supports async provider jobs (createDescriptionJob and
 * getDescriptionJob are guaranteed present).
 * @typedef {Describer & { createDescriptionJob: (imageSource: string) => Promise<ProviderJob>, getDescriptionJob: (providerJobId: string, imageSource: string) => Promise<ProviderJob> }} AsyncDescriber
 */

/**
 * @typedef {object} ScraperService
 * @property {(pageUrl: string) => Promise<{ imageSources: string[] }>} getImages
 */

/**
 * @typedef {object} ImageDescriberFactory
 * @property {(model: string) => Describer} get
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const toPositiveInteger = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const DEFAULT_ASYNC_POLL_INTERVAL_MS = 1000;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
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
   * @param {ScraperService} deps.scraperService - ScraperService instance
   * @param {ImageDescriberFactory} deps.imageDescriberFactory - ImageDescriberFactory instance
   * @param {number} [deps.concurrency] - max concurrent provider calls for page descriptions
   * @param {number} [deps.asyncPollIntervalMs] - polling interval for async provider jobs
   * @param {Function} [deps.sleep] - injected delay helper for tests
   */
  constructor({
    scraperService,
    imageDescriberFactory,
    concurrency = 3,
    asyncPollIntervalMs = DEFAULT_ASYNC_POLL_INTERVAL_MS,
    sleep: wait = sleep,
  }) {
    this.scraperService = scraperService;
    this.imageDescriberFactory = imageDescriberFactory;
    this.concurrency = toPositiveInteger(concurrency, 3);
    this.asyncPollIntervalMs = toPositiveInteger(
      asyncPollIntervalMs,
      DEFAULT_ASYNC_POLL_INTERVAL_MS,
    );
    this.sleep = wait;
  }

  /**
   * @param {Describer} describer
   * @returns {describer is AsyncDescriber}
   */
  static supportsAsyncJobs(describer) {
    return typeof describer?.createDescriptionJob === 'function'
      && typeof describer?.getDescriptionJob === 'function';
  }

  /**
   * @param {{ pageUrl: string, model: string }} params
   * @returns {Promise<{ describer: Describer, filteredImageSources: string[], uniqueImageSources: string[] }>}
   */
  async collectPageImages({ pageUrl, model }) {
    const describer = this.imageDescriberFactory.get(model);
    const { imageSources } = await this.scraperService.getImages(pageUrl);
    const filteredImageSources = typeof describer.filterSupportedImageSources === 'function'
      ? describer.filterSupportedImageSources(imageSources)
      : imageSources;

    return {
      describer,
      filteredImageSources,
      uniqueImageSources: [...new Set(filteredImageSources)],
    };
  }

  /**
   * @param {string[]} uniqueImageSources
   * @param {(imageSource: string) => Promise<ImageDescription>} describeImage
   * @returns {Promise<Map<string, SettledDescription>>}
   */
  async describeUniqueImages(uniqueImageSources, describeImage) {
    return new Map(
      await mapWithConcurrencyLimit(
        uniqueImageSources,
        this.concurrency,
        async (imageSource) => {
          try {
            return /** @type {[string, SettledDescription]} */ ([imageSource, {
              status: 'fulfilled',
              value: await describeImage(imageSource),
            }]);
          } catch (error) {
            return /** @type {[string, SettledDescription]} */ ([imageSource, { status: 'rejected', reason: error }]);
          }
        },
      ),
    );
  }

  /**
   * @param {{ describer: Describer, filteredImageSources: string[], uniqueImageSources: string[], pageUrl: string, model: string, describeImage: (imageSource: string) => Promise<ImageDescription> }} params
   * @returns {Promise<{ pageUrl: string, model: string, totalImages: number, uniqueImages: number, descriptions: ImageDescription[] }>}
   */
  async describeCollectedPage({
    describer,
    filteredImageSources,
    uniqueImageSources,
    pageUrl,
    model,
    describeImage,
  }) {
    const settledDescriptions = await this.describeUniqueImages(
      uniqueImageSources,
      describeImage,
    );

    return /** @type {typeof PageDescriptionService} */ (this.constructor).buildPageResult({
      describer,
      filteredImageSources,
      settledDescriptions,
      pageUrl,
      model,
    });
  }

  /**
   * @param {{ describer: AsyncDescriber, imageSource: string, providerJob: ProviderJob }} params
   * @returns {Promise<ImageDescription>}
   */
  async waitForAsyncDescriptionJob({ describer, imageSource, providerJob }) {
    if (providerJob.status === 'succeeded') {
      return /** @type {ImageDescription} */ (providerJob.result);
    }

    if (providerJob.status === 'failed' || providerJob.status === 'canceled') {
      throw providerJob.error ?? new Error('Description job failed');
    }

    return this.pollAsyncDescriptionJob({
      describer,
      imageSource,
      providerJobId: providerJob.providerJobId,
    });
  }

  /**
   * @param {{ describer: AsyncDescriber, imageSource: string, providerJobId: string }} params
   * @returns {Promise<ImageDescription>}
   */
  async pollAsyncDescriptionJob({ describer, imageSource, providerJobId }) {
    await this.sleep(this.asyncPollIntervalMs);
    const providerJob = await describer.getDescriptionJob(providerJobId, imageSource);

    if (providerJob.status === 'succeeded') {
      return /** @type {ImageDescription} */ (providerJob.result);
    }

    if (providerJob.status === 'failed' || providerJob.status === 'canceled') {
      throw providerJob.error ?? new Error('Description job failed');
    }

    return this.pollAsyncDescriptionJob({
      describer,
      imageSource,
      providerJobId,
    });
  }

  /**
   * @param {{ describer: Describer, filteredImageSources: string[], settledDescriptions: Map<string, SettledDescription>, pageUrl: string, model: string }} params
   * @returns {{ pageUrl: string, model: string, totalImages: number, uniqueImages: number, descriptions: ImageDescription[] }}
   */
  static buildPageResult({
    describer,
    filteredImageSources,
    settledDescriptions,
    pageUrl,
    model,
  }) {
    const successfulImageSources = /** @type {string[]} */ ([]);
    const descriptions = /** @type {ImageDescription[]} */ ([]);

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
    const {
      describer,
      filteredImageSources,
      uniqueImageSources,
    } = await this.collectPageImages({ pageUrl, model });

    return this.describeCollectedPage({
      describer,
      filteredImageSources,
      uniqueImageSources,
      pageUrl,
      model,
      describeImage: (imageSource) => describer.describeImage(imageSource),
    });
  }

  /**
   * @param {{ pageUrl: string, model: string, describeImage: (imageSource: string) => Promise<ImageDescription> }} params
   * @returns {Promise<{ pageUrl: string, model: string, totalImages: number, uniqueImages: number, descriptions: ImageDescription[] }>}
   */
  async describePageWithResolver({ pageUrl, model, describeImage }) {
    const {
      describer,
      filteredImageSources,
      uniqueImageSources,
    } = await this.collectPageImages({ pageUrl, model });

    return this.describeCollectedPage({
      describer,
      filteredImageSources,
      uniqueImageSources,
      pageUrl,
      model,
      describeImage,
    });
  }

  /**
   * @param {{ pageUrl: string, model: string }} params
   * @returns {Promise<{ pageUrl: string, model: string, totalImages: number, uniqueImages: number, descriptions: ImageDescription[] }>}
   */
  async describePageWithAsyncJobs({ pageUrl, model }) {
    const {
      describer,
      filteredImageSources,
      uniqueImageSources,
    } = await this.collectPageImages({ pageUrl, model });

    if (!(/** @type {typeof PageDescriptionService} */ (this.constructor)).supportsAsyncJobs(describer)) {
      return this.describeCollectedPage({
        describer,
        filteredImageSources,
        uniqueImageSources,
        pageUrl,
        model,
        describeImage: (imageSource) => describer.describeImage(imageSource),
      });
    }

    return this.describeCollectedPage({
      describer,
      filteredImageSources,
      uniqueImageSources,
      pageUrl,
      model,
      describeImage: async (imageSource) => {
        const providerJob = await describer.createDescriptionJob(imageSource);
        return this.waitForAsyncDescriptionJob({
          describer,
          imageSource,
          providerJob,
        });
      },
    });
  }
}

module.exports = PageDescriptionService;
