const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');
const { fetchImageAsset } = require('../providers/shared/fetchImageAsset');
const { extractCaptionText } = require('../providers/shared/extractCaptionText');
const { isSkippableImageSourceError } = require('../providers/shared/isSkippableImageSourceError');

/**
 * Image description service backed by Ollama's local multimodal chat API.
 */
class OllamaDescriberService {
  /**
   * @param {object} deps
   * @param {object} deps.logger
   * @param {object} deps.httpClient
   * @param {object} [deps.apiClient]
   * @param {object} deps.providerConfig
   * @param {object} [deps.requestOptions]
   */
  constructor({
    logger,
    httpClient,
    apiClient = httpClient,
    providerConfig,
    requestOptions = {},
  }) {
    this.logger = logger;
    this.httpClient = httpClient;
    this.apiClient = apiClient;
    this.endpoint = providerConfig.baseUrl?.replace(/\/+$/, '');
    this.model = providerConfig.model;
    this.prompt = providerConfig.prompt;
    this.keepAlive = providerConfig.keepAlive;
    this.requestOptions = requestOptions;

    if (!this.endpoint || !this.model) {
      throw new Error('Ollama provider requires baseUrl and model');
    }
  }

  buildChatUrl() {
    return this.endpoint.endsWith('/api')
      ? `${this.endpoint}/chat`
      : `${this.endpoint}/api/chat`;
  }

  shouldSkipDescriptionError(error) {
    const message = typeof error?.message === 'string' ? error.message : '';

    if (message === 'Ollama provider received an empty image payload') {
      return true;
    }

    return isSkippableImageSourceError(error, this.endpoint);
  }

  /**
   * @param {string} imageUrl
   * @returns {Promise<{ description: string, imageUrl: string }>}
   */
  async describeImage(imageUrl) {
    this.logger.info({ imageUrl, model: this.model, provider: 'ollama' }, 'Generating alt text');

    try {
      const imageAsset = await fetchImageAsset({
        httpClient: this.httpClient,
        imageUrl,
        requestOptions: this.requestOptions,
      });

      if (imageAsset.buffer.length === 0) {
        throw new Error('Ollama provider received an empty image payload');
      }

      const response = await this.apiClient.post(
        this.buildChatUrl(),
        {
          model: this.model,
          messages: [
            {
              role: 'user',
              content: this.prompt,
              images: [imageAsset.buffer.toString('base64')],
            },
          ],
          stream: false,
          ...(this.keepAlive ? { keep_alive: this.keepAlive } : {}),
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: this.requestOptions.timeout,
        },
      );

      const description = extractCaptionText(response?.data);

      if (!description) {
        throw new Error('Ollama provider returned no caption text');
      }

      this.logger.debug({ imageUrl, provider: 'ollama' }, 'Alt text generated');
      return { description, imageUrl };
    } catch (error) {
      this.logger.error({
        err: error,
        provider: 'ollama',
        endpoint: this.endpoint,
        imageUrl,
        model: this.model,
        upstream: getUpstreamErrorSummary(error),
      }, 'Ollama description request failed');
      throw error;
    }
  }
}

module.exports = OllamaDescriberService;
