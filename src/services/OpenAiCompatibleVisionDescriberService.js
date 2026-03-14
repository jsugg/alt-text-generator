const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');
const { fetchImageAsset } = require('../providers/shared/fetchImageAsset');
const { extractCaptionText } = require('../providers/shared/extractCaptionText');
const { isSkippableImageSourceError } = require('../providers/shared/isSkippableImageSourceError');

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
]);
const UNSUPPORTED_CONTENT_TYPES = new Set(['image/svg+xml']);
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT']);
const DEFAULT_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 5000;
const RETRY_JITTER_MS = 250;

const toDataUrl = ({ buffer, contentType }) => (
  `data:${contentType || 'application/octet-stream'};base64,${buffer.toString('base64')}`
);

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const shouldRetryWithDataUrl = (error) => {
  const status = error?.response?.status;

  return status === 400
    || status === 413
    || status === 415
    || status === 422;
};

const getImageExtension = (imageUrl) => {
  try {
    const { pathname } = new URL(imageUrl);
    const lastSegment = pathname.split('/').pop()?.toLowerCase() || '';
    const extensionIndex = lastSegment.lastIndexOf('.');

    if (extensionIndex < 0) {
      return '';
    }

    return lastSegment.slice(extensionIndex);
  } catch {
    return '';
  }
};

const isPrivateIpv4Hostname = (hostname) => {
  const octets = hostname.split('.').map(Number);

  if (
    octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
};

const shouldUseFetchedImageInput = (imageUrl) => {
  try {
    const { hostname, protocol } = new URL(imageUrl);

    if (protocol !== 'http:' && protocol !== 'https:') {
      return true;
    }

    return hostname === 'localhost'
      || hostname === '::1'
      || isPrivateIpv4Hostname(hostname);
  } catch {
    return false;
  }
};

const isSupportedImageSource = (imageUrl) => {
  const imageExtension = getImageExtension(imageUrl);

  if (!imageExtension) {
    return true;
  }

  return SUPPORTED_IMAGE_EXTENSIONS.has(imageExtension);
};

const parseRetryAfterMs = (error) => {
  const retryAfterHeader = error?.response?.headers?.['retry-after'];
  const retryAfterValue = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;

  if (typeof retryAfterValue !== 'string') {
    return null;
  }

  const retryAfterSeconds = Number.parseInt(retryAfterValue, 10);
  if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAfterTimestamp = Date.parse(retryAfterValue);
  if (Number.isNaN(retryAfterTimestamp)) {
    return null;
  }

  return Math.max(retryAfterTimestamp - Date.now(), 0);
};

const isRetryableRequestError = (error) => {
  const status = error?.response?.status;
  if (RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  return RETRYABLE_ERROR_CODES.has(error?.code);
};

const getRetryDelayMs = (error, attemptNumber) => {
  const retryAfterMs = parseRetryAfterMs(error);
  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, RETRY_MAX_DELAY_MS);
  }

  const backoffDelayMs = Math.min(
    RETRY_BASE_DELAY_MS * (2 ** Math.max(attemptNumber - 1, 0)),
    RETRY_MAX_DELAY_MS,
  );
  const jitterMs = Math.floor(Math.random() * RETRY_JITTER_MS);

  return Math.min(backoffDelayMs + jitterMs, RETRY_MAX_DELAY_MS);
};

/**
 * Multimodal describer for OpenAI-compatible chat-completions APIs.
 */
class OpenAiCompatibleVisionDescriberService {
  /**
   * @param {object} deps
   * @param {object} deps.logger
   * @param {object} deps.httpClient - axios-compatible HTTP client for image downloads
   * @param {object} [deps.apiClient] - axios-compatible API client for provider requests
   * @param {object} deps.providerConfig
   * @param {string} deps.providerKey
   * @param {string} deps.providerName
   * @param {object} [deps.requestOptions]
   */
  constructor({
    logger,
    httpClient,
    apiClient = httpClient,
    providerConfig,
    providerKey,
    providerName,
    requestOptions = {},
    sleep: wait = sleep,
  }) {
    this.logger = logger;
    this.httpClient = httpClient;
    this.apiClient = apiClient;
    this.providerKey = providerKey;
    this.providerName = providerName;
    this.endpoint = providerConfig.baseUrl?.replace(/\/+$/, '');
    this.apiKey = providerConfig.apiKey;
    this.model = providerConfig.model;
    this.maxTokens = providerConfig.maxTokens;
    this.prompt = providerConfig.prompt;
    this.headers = providerConfig.headers ?? {};
    this.requestOptions = requestOptions;
    this.requestAttempts = providerConfig.requestAttempts ?? DEFAULT_REQUEST_ATTEMPTS;
    this.sleep = wait;

    if (!this.endpoint || !this.apiKey || !this.model) {
      throw new Error(
        `${providerName} provider requires apiKey, baseUrl, and model`,
      );
    }
  }

  buildChatUrl() {
    return `${this.endpoint}/chat/completions`;
  }

  buildRequestBody(imageInput) {
    return {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: this.prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageInput,
              },
            },
          ],
        },
      ],
      max_tokens: this.maxTokens,
      stream: false,
    };
  }

  async requestCaption(imageInput, imageUrl, attemptNumber = 1) {
    try {
      const response = await this.apiClient.post(
        this.buildChatUrl(),
        this.buildRequestBody(imageInput),
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            ...this.headers,
          },
          timeout: this.requestOptions.timeout,
        },
      );

      const description = extractCaptionText(response?.data);

      if (!description) {
        throw new Error(`${this.providerName} provider returned no caption text`);
      }

      return { description, imageUrl };
    } catch (error) {
      if (!isRetryableRequestError(error) || attemptNumber >= this.requestAttempts) {
        throw error;
      }

      const delayMs = getRetryDelayMs(error, attemptNumber);
      this.logger.warn?.({
        provider: this.providerKey,
        imageUrl,
        model: this.model,
        attemptNumber,
        maxAttempts: this.requestAttempts,
        delayMs,
        upstream: getUpstreamErrorSummary(error),
      }, `${this.providerName} request failed, retrying`);
      await this.sleep(delayMs);

      return this.requestCaption(imageInput, imageUrl, attemptNumber + 1);
    }
  }

  static supportsImageSource(imageUrl) {
    return isSupportedImageSource(imageUrl);
  }

  logFailure(error, imageUrl) {
    this.logger.error({
      err: error,
      provider: this.providerKey,
      endpoint: this.endpoint,
      imageUrl,
      model: this.model,
      upstream: getUpstreamErrorSummary(error),
    }, `${this.providerName} description request failed`);
  }

  filterSupportedImageSources(imageSources) {
    return imageSources.filter((imageSource) => this.constructor.supportsImageSource(imageSource));
  }

  shouldSkipDescriptionError(error) {
    const message = typeof error?.message === 'string' ? error.message : '';

    if (message.endsWith('provider received an empty image payload')) {
      return true;
    }

    if (message.includes('provider does not support content type')) {
      return true;
    }

    return isSkippableImageSourceError(error, this.endpoint);
  }

  async describeFetchedImage(imageUrl, successMessage) {
    const imageAsset = await fetchImageAsset({
      httpClient: this.httpClient,
      imageUrl,
      requestOptions: this.requestOptions,
    });

    if (imageAsset.buffer.length === 0) {
      throw new Error(`${this.providerName} provider received an empty image payload`);
    }

    if (UNSUPPORTED_CONTENT_TYPES.has(imageAsset.contentType)) {
      throw new Error(
        `${this.providerName} provider does not support content type '${imageAsset.contentType}'`,
      );
    }

    const result = await this.requestCaption(toDataUrl(imageAsset), imageUrl);
    this.logger.debug(
      { imageUrl, provider: this.providerKey },
      successMessage,
    );
    return result;
  }

  /**
   * @param {string} imageUrl
   * @returns {Promise<{ description: string, imageUrl: string }>}
   */
  async describeImage(imageUrl) {
    this.logger.info(
      { imageUrl, model: this.model, provider: this.providerKey },
      'Generating alt text',
    );

    if (shouldUseFetchedImageInput(imageUrl)) {
      try {
        return await this.describeFetchedImage(
          imageUrl,
          'Alt text generated with fetched image payload',
        );
      } catch (error) {
        this.logFailure(error, imageUrl);
        throw error;
      }
    }

    try {
      const result = await this.requestCaption(imageUrl, imageUrl);
      this.logger.debug({ imageUrl, provider: this.providerKey }, 'Alt text generated');
      return result;
    } catch (error) {
      if (shouldRetryWithDataUrl(error)) {
        try {
          return await this.describeFetchedImage(
            imageUrl,
            'Alt text generated with fetched image fallback',
          );
        } catch (fallbackError) {
          this.logFailure(fallbackError, imageUrl);
          throw fallbackError;
        }
      }

      this.logFailure(error, imageUrl);
      throw error;
    }
  }
}

module.exports = OpenAiCompatibleVisionDescriberService;
