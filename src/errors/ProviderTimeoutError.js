class ProviderTimeoutError extends Error {
  /**
   * @param {object} params
   * @param {string} params.provider
   * @param {string} params.message
   * @param {number} params.timeoutMs
   * @param {string} [params.imageUrl]
   * @param {string} [params.providerJobId]
   * @param {string} [params.modelRef]
   */
  constructor({
    provider,
    message,
    timeoutMs,
    imageUrl,
    providerJobId,
    modelRef,
  }) {
    super(message);
    this.name = 'ProviderTimeoutError';
    this.provider = provider;
    this.timeoutMs = timeoutMs;

    if (imageUrl) {
      this.imageUrl = imageUrl;
    }

    if (providerJobId) {
      this.providerJobId = providerJobId;
    }

    if (modelRef) {
      this.modelRef = modelRef;
    }
  }
}

const isProviderTimeoutError = (error) => error instanceof ProviderTimeoutError;

module.exports = {
  ProviderTimeoutError,
  isProviderTimeoutError,
};
