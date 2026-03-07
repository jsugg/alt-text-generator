/**
 * Image description service backed by Azure Computer Vision.
 *
 * Implements the IImageDescriber interface:
 *   describeImage(imageUrl: string): Promise<{ description: string, imageUrl: string }>
 */
class AzureDescriberService {
  /**
   * @param {object} deps
   * @param {object} deps.logger - pino logger instance
   * @param {object} deps.httpClient - axios-compatible HTTP client
   * @param {object} deps.config - app config (config.azure)
   */
  constructor({ logger, httpClient, config }) {
    this.logger = logger;
    this.httpClient = httpClient;
    this.endpoint = config.azure.apiEndpoint;
    this.subscriptionKey = config.azure.subscriptionKey;
    this.language = config.azure.language;
    this.maxCandidates = config.azure.maxCandidates;

    if (!this.endpoint || !this.subscriptionKey) {
      throw new Error('Azure provider requires both apiEndpoint and subscriptionKey');
    }
  }

  /**
   * Generates an alt-text description for a single image URL via Azure CV.
   * Errors propagate to the caller — no silent swallowing.
   * @param {string} imageUrl
   * @returns {Promise<{ description: string, imageUrl: string }>}
   */
  async describeImage(imageUrl) {
    const url = `${this.endpoint}?maxCandidates=${this.maxCandidates}&language=${this.language}&model-version=latest`;

    const headers = {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': this.subscriptionKey,
    };

    // Correct axios usage: post(url, data, config)
    const response = await this.httpClient.post(
      url,
      { url: imageUrl },
      { headers },
    );

    // axios already parses JSON — use response.data, not response.json()
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
  }
}

module.exports = AzureDescriberService;
