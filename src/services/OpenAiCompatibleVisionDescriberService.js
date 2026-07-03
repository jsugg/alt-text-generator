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
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET']);
const DEFAULT_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 5000;
const RETRY_JITTER_MS = 250;

/**
 * @typedef {object} Logger
 * @property {(...args: unknown[]) => void} info
 * @property {(...args: unknown[]) => void} debug
 * @property {(...args: unknown[]) => void} error
 * @property {(...args: unknown[]) => void} [warn]
 */

/**
 * @typedef {object} HttpClient
 * @property {(url: string, body: unknown, config: object) => Promise<{ data?: unknown }>} post
 */

/**
 * @typedef {object} ProviderConfig
 * @property {string} [baseUrl]
 * @property {string} [apiKey]
 * @property {string} [model]
 * @property {number} [maxTokens]
 * @property {string} [prompt]
 * @property {Record<string, string>} [headers]
 * @property {number} [requestAttempts]
 */

/**
 * @typedef {object} RequestOptions
 * @property {number} [timeout]
 */

/**
 * @typedef {object} ImageAsset
 * @property {Buffer} buffer
 * @property {string | null} contentType
 */

/**
 * A duck-typed axios-style request error.
 * @typedef {object} HttpError
 * @property {{ status?: number, headers?: Record<string, unknown> }} [response]
 * @property {string} [code]
 * @property {string} [message]
 */

/**
 * @param {ImageAsset} asset
 * @returns {string}
 */
const toDataUrl = ({ buffer, contentType }) => (
  `data:${contentType || 'application/octet-stream'};base64,${buffer.toString('base64')}`
);

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * @param {unknown} error
 * @returns {boolean}
 */
const shouldRetryWithDataUrl = (error) => {
  const status = (/** @type {HttpError} */ (error))?.response?.status;

  return status === 400
    || status === 413
    || status === 415
    || status === 422;
};

/**
 * @param {string} imageUrl
 * @returns {string}
 */
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

/**
 * @param {string} hostname
 * @returns {boolean}
 */
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

/**
 * @param {string} imageUrl
 * @returns {boolean}
 */
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

/**
 * @param {string} imageUrl
 * @returns {boolean}
 */
const isSupportedImageSource = (imageUrl) => {
  const imageExtension = getImageExtension(imageUrl);

  if (!imageExtension) {
    return true;
  }

  return SUPPORTED_IMAGE_EXTENSIONS.has(imageExtension);
};

/**
 * @param {unknown} error
 * @returns {number|null}
 */
const parseRetryAfterMs = (error) => {
  const retryAfterHeader = (/** @type {HttpError} */ (error))?.response?.headers?.['retry-after'];
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

/**
 * @param {unknown} error
 * @returns {boolean}
 */
const isRetryableRequestError = (error) => {
  const httpError = /** @type {HttpError} */ (error);
  const status = httpError?.response?.status;
  if (RETRYABLE_STATUS_CODES.has(/** @type {number} */ (status))) {
    return true;
  }

  return RETRYABLE_ERROR_CODES.has(/** @type {string} */ (httpError?.code));
};

/**
 * @param {unknown} error
 * @param {number} attemptNumber
 * @returns {number}
 */
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
   * @param {Logger} deps.logger
   * @param {HttpClient} deps.httpClient - axios-compatible HTTP client for image downloads
   * @param {HttpClient} [deps.apiClient] - axios-compatible API client for provider requests
   * @param {ProviderConfig} deps.providerConfig
   * @param {string} deps.providerKey
   * @param {string} deps.providerName
   * @param {Function} [deps.outboundUrlPolicy] - validates user-controlled outbound URLs
   * @param {RequestOptions} [deps.requestOptions]
   * @param {(ms: number) => Promise<void>} [deps.sleep]
   */
  constructor({
    logger,
    httpClient,
    apiClient = httpClient,
    outboundUrlPolicy,
    providerConfig,
    providerKey,
    providerName,
    requestOptions = {},
    sleep: wait = sleep,
  }) {
    this.logger = logger;
    this.httpClient = httpClient;
    this.apiClient = apiClient;
    this.outboundUrlPolicy = outboundUrlPolicy;
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

  /**
   * @param {string} imageInput
   */
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

  /**
   * @param {string} imageInput
   * @param {string} imageUrl
   * @param {number} [attemptNumber]
   * @returns {Promise<{ description: string, imageUrl: string }>}
   */
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

  /**
   * @param {string} imageUrl
   * @returns {boolean}
   */
  static supportsImageSource(imageUrl) {
    return isSupportedImageSource(imageUrl);
  }

  /**
   * @param {unknown} error
   * @param {string} imageUrl
   * @returns {void}
   */
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

  /**
   * @param {string[]} imageSources
   * @returns {string[]}
   */
  filterSupportedImageSources(imageSources) {
    return imageSources.filter((imageSource) => (/** @type {typeof OpenAiCompatibleVisionDescriberService} */ (this.constructor)).supportsImageSource(imageSource));
  }

  /**
   * @param {unknown} error
   * @returns {boolean}
   */
  shouldSkipDescriptionError(error) {
    const rawMessage = (/** @type {HttpError} */ (error))?.message;
    const message = typeof rawMessage === 'string' ? rawMessage : '';

    if (message.endsWith('provider received an empty image payload')) {
      return true;
    }

    if (message.includes('provider does not support content type')) {
      return true;
    }

    return isSkippableImageSourceError(error, this.endpoint);
  }

  /**
   * @param {string} imageUrl
   * @param {string} successMessage
   * @returns {Promise<{ description: string, imageUrl: string }>}
   */
  async describeFetchedImage(imageUrl, successMessage) {
    const imageAsset = await fetchImageAsset({
      httpClient: this.httpClient,
      imageUrl,
      outboundUrlPolicy: this.outboundUrlPolicy,
      requestOptions: this.requestOptions,
    });

    if (imageAsset.buffer.length === 0) {
      throw new Error(`${this.providerName} provider received an empty image payload`);
    }

    if (UNSUPPORTED_CONTENT_TYPES.has(/** @type {string} */ (imageAsset.contentType))) {
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
