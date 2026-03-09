const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');

/**
 * Image description service backed by the Replicate AI platform.
 *
 * Implements the IImageDescriber interface:
 *   describeImage(imageUrl: string): Promise<{ description: string, imageUrl: string }>
 */
class ReplicateDescriberService {
  /**
   * @param {object} deps
   * @param {object} deps.logger - pino logger instance
   * @param {object} deps.replicateClient - instantiated Replicate SDK client
   * @param {object} deps.config - app config (config.replicate)
   */
  constructor({ logger, replicateClient, config }) {
    this.logger = logger;
    this.replicate = replicateClient;
    this.modelOwner = config.replicate.modelOwner;
    this.modelName = config.replicate.modelName;
    this.modelVersion = config.replicate.modelVersion;
  }

  /**
   * Generates an alt-text description for a single image URL.
   * Errors propagate to the caller — no silent swallowing.
   * @param {string} imageUrl
   * @returns {Promise<{ description: string, imageUrl: string }>}
   */
  async describeImage(imageUrl) {
    const modelRef = `${this.modelOwner}/${this.modelName}:${this.modelVersion}`;
    this.logger.info({ imageUrl, modelRef }, 'Generating alt text');

    try {
      const output = await this.replicate.run(modelRef, {
        input: { image: imageUrl },
      });

      this.logger.debug({ imageUrl }, 'Alt text generated');
      return { description: output, imageUrl };
    } catch (error) {
      this.logger.error({
        err: error,
        provider: 'replicate',
        imageUrl,
        modelRef,
        upstream: getUpstreamErrorSummary(error),
      }, 'Replicate prediction failed');
      throw error;
    }
  }
}

module.exports = ReplicateDescriberService;
