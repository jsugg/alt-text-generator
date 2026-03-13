const path = require('path');

const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');
const { fetchImageAsset } = require('../providers/shared/fetchImageAsset');
const { isSkippableImageSourceError } = require('../providers/shared/isSkippableImageSourceError');

/**
 * Image description service backed by Azure Computer Vision.
 *
 * Implements the IImageDescriber interface:
 *   describeImage(imageUrl: string): Promise<{ description: string, imageUrl: string }>
 */
class AzureDescriberService {
  static SUPPORTED_CONTENT_TYPES = new Set([
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/webp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  ]);

  static UNSUPPORTED_EXTENSIONS = new Set([
    '.svg',
  ]);

  /**
   * @param {object} deps
   * @param {object} deps.logger - pino logger instance
   * @param {object} deps.httpClient - axios-compatible HTTP client
   * @param {object} deps.providerConfig - provider config section
   * @param {object} deps.requestOptions - bounded outbound request options
   */
  constructor({
    logger,
    httpClient,
    providerConfig,
    requestOptions = {},
  }) {
    this.logger = logger;
    this.httpClient = httpClient;
    this.endpoint = providerConfig.apiEndpoint;
    this.subscriptionKey = providerConfig.subscriptionKey;
    this.language = providerConfig.language;
    this.maxCandidates = providerConfig.maxCandidates;
    this.requestOptions = requestOptions;

    if (!this.endpoint || !this.subscriptionKey) {
      throw new Error('Azure provider requires both apiEndpoint and subscriptionKey');
    }
  }

  /**
   * Returns whether the remote image URL is worth attempting with Azure CV.
   * @param {string} imageUrl
   * @returns {boolean}
   */
  static supportsImageSource(imageUrl) {
    const cleanUrl = imageUrl.toLowerCase().split('?')[0];
    const extension = path.extname(cleanUrl);
    return !AzureDescriberService.UNSUPPORTED_EXTENSIONS.has(extension);
  }

  /**
   * Filters out image URLs that Azure CV cannot process.
   * @param {string[]} imageSources
   * @returns {string[]}
   */
  filterSupportedImageSources(imageSources) {
    return imageSources.filter((imageSource) => this.constructor.supportsImageSource(imageSource));
  }

  /**
   * Returns whether a page-description failure is specific to one source image
   * and can therefore be skipped without hiding provider-wide outages.
   * @param {unknown} error
   * @returns {boolean}
   */
  shouldSkipDescriptionError(error) {
    const message = typeof error?.message === 'string' ? error.message : '';

    if (
      message.startsWith('Azure provider does not support content type')
      || message === 'Azure provider received an empty image payload'
    ) {
      return true;
    }

    const requestUrl = typeof error?.config?.url === 'string'
      ? error.config.url
      : null;
    const isAzureRequest = Boolean(requestUrl && requestUrl.startsWith(this.endpoint));

    if (isAzureRequest) {
      const status = error?.response?.status;
      const errorCode = error?.response?.data?.error?.innererror?.code
        || error?.response?.data?.error?.code
        || null;

      return status === 400 && (
        errorCode === 'InvalidImageFormat'
        || errorCode === 'InvalidImageUrl'
      );
    }

    return isSkippableImageSourceError(error, this.endpoint);
  }

  /**
   * @param {string} value
   * @returns {string | null}
   */
  static normalizeContentType(value) {
    if (!value || typeof value !== 'string') {
      return null;
    }

    return value.split(';')[0].trim().toLowerCase();
  }

  /**
   * @param {string | null} contentType
   * @returns {boolean}
   */
  static isSupportedContentType(contentType) {
    if (!contentType) {
      return true;
    }

    return AzureDescriberService.SUPPORTED_CONTENT_TYPES.has(contentType);
  }

  /**
   * @param {boolean} useStream
   * @returns {string}
   */
  buildDescribeUrl(useStream = false) {
    const url = new URL(this.endpoint);
    url.searchParams.set('maxCandidates', this.maxCandidates);
    url.searchParams.set('language', this.language);
    url.searchParams.set('model-version', 'latest');

    if (useStream) {
      url.searchParams.set('overload', 'stream');
    }

    return url.toString();
  }

  /**
   * Downloads the image so Azure does not need to resolve third-party URLs itself.
   * @param {string} imageUrl
   * @returns {Promise<Buffer>}
   */
  async fetchImageBuffer(imageUrl) {
    const { buffer, contentType } = await fetchImageAsset({
      httpClient: this.httpClient,
      imageUrl,
      requestOptions: this.requestOptions,
    });

    if (!AzureDescriberService.isSupportedContentType(contentType)) {
      throw new Error(`Azure provider does not support content type '${contentType}'`);
    }

    const imageBuffer = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer);

    if (imageBuffer.length === 0) {
      throw new Error('Azure provider received an empty image payload');
    }

    return imageBuffer;
  }

  /**
   * Generates an alt-text description for a single image URL via Azure CV.
   * Errors propagate to the caller — no silent swallowing.
   * @param {string} imageUrl
   * @returns {Promise<{ description: string, imageUrl: string }>}
   */
  async describeImage(imageUrl) {
    try {
      const imageBuffer = await this.fetchImageBuffer(imageUrl);

      const response = await this.httpClient.post(
        this.buildDescribeUrl(true),
        imageBuffer,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
          },
        },
      );

      const captions = response?.data?.description?.captions;

      if (!Array.isArray(captions) || captions.length === 0) {
        throw new Error('Azure provider returned no captions');
      }

      const description = captions
        .map((caption) => caption.text)
        .filter(Boolean)
        .join(', ');

      if (!description) {
        throw new Error('Azure provider returned empty captions');
      }

      this.logger.debug({ imageUrl }, 'Azure alt text generated');
      return { description, imageUrl };
    } catch (error) {
      this.logger.error({
        err: error,
        provider: 'azure',
        endpoint: this.endpoint,
        imageUrl,
        upstream: getUpstreamErrorSummary(error),
      }, 'Azure description request failed');
      throw error;
    }
  }
}

module.exports = AzureDescriberService;
