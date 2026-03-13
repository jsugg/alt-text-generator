const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');
const { fetchImageAsset } = require('../providers/shared/fetchImageAsset');
const { extractCaptionText } = require('../providers/shared/extractCaptionText');
const { isSkippableImageSourceError } = require('../providers/shared/isSkippableImageSourceError');

const toDataUrl = ({ buffer, contentType }) => (
  `data:${contentType || 'application/octet-stream'};base64,${buffer.toString('base64')}`
);

const shouldRetryWithDataUrl = (error) => {
  const status = error?.response?.status;

  return status === 400
    || status === 413
    || status === 415
    || status === 422;
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

  async requestCaption(imageInput, imageUrl) {
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
  }

  shouldSkipDescriptionError(error) {
    const message = typeof error?.message === 'string' ? error.message : '';

    if (message.endsWith('provider received an empty image payload')) {
      return true;
    }

    return isSkippableImageSourceError(error, this.endpoint);
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

    try {
      const result = await this.requestCaption(imageUrl, imageUrl);
      this.logger.debug({ imageUrl, provider: this.providerKey }, 'Alt text generated');
      return result;
    } catch (error) {
      if (shouldRetryWithDataUrl(error)) {
        try {
          const imageAsset = await fetchImageAsset({
            httpClient: this.httpClient,
            imageUrl,
            requestOptions: this.requestOptions,
          });

          if (imageAsset.buffer.length === 0) {
            throw new Error(`${this.providerName} provider received an empty image payload`);
          }

          const result = await this.requestCaption(toDataUrl(imageAsset), imageUrl);
          this.logger.debug(
            { imageUrl, provider: this.providerKey },
            'Alt text generated with fetched image fallback',
          );
          return result;
        } catch (fallbackError) {
          this.logger.error({
            err: fallbackError,
            provider: this.providerKey,
            endpoint: this.endpoint,
            imageUrl,
            model: this.model,
            upstream: getUpstreamErrorSummary(fallbackError),
          }, `${this.providerName} description request failed`);
          throw fallbackError;
        }
      }

      this.logger.error({
        err: error,
        provider: this.providerKey,
        endpoint: this.endpoint,
        imageUrl,
        model: this.model,
        upstream: getUpstreamErrorSummary(error),
      }, `${this.providerName} description request failed`);
      throw error;
    }
  }
}

module.exports = OpenAiCompatibleVisionDescriberService;
