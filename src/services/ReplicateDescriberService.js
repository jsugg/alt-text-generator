const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');
const { ProviderTimeoutError } = require('../errors/ProviderTimeoutError');

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const toPositiveIntegerOrFallback = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const extractDescriptionText = (output) => {
  if (typeof output === 'string' && output.trim().length > 0) {
    return output.trim();
  }

  if (Array.isArray(output)) {
    const joinedOutput = output
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .join('')
      .trim();

    if (joinedOutput.length > 0) {
      return joinedOutput;
    }
  }

  throw new Error('Replicate provider returned no caption text');
};

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
   * @param {object} deps.providerConfig - provider config section
   * @param {object} [deps.requestOptions]
   */
  constructor({
    logger,
    replicateClient,
    providerConfig,
    requestOptions = {},
    sleep: wait = sleep,
  }) {
    this.logger = logger;
    this.replicate = replicateClient;
    this.modelOwner = providerConfig.modelOwner;
    this.modelName = providerConfig.modelName;
    this.modelVersion = providerConfig.modelVersion;
    this.requestTimeoutMs = toPositiveIntegerOrFallback(
      providerConfig.requestTimeoutMs,
      requestOptions.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    this.pollIntervalMs = toPositiveIntegerOrFallback(
      providerConfig.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
    );
    this.sleep = wait;
    this.supportsAsyncJobs = true;
  }

  buildModelRef() {
    return `${this.modelOwner}/${this.modelName}:${this.modelVersion}`;
  }

  async cancelPrediction(predictionId, imageUrl) {
    try {
      await this.replicate.predictions.cancel(predictionId);
    } catch (error) {
      this.logger.warn?.({
        err: error,
        imageUrl,
        predictionId,
        provider: 'replicate',
      }, 'Failed to cancel timed-out Replicate prediction');
    }
  }

  static normalizePrediction(prediction, imageUrl) {
    const baseJob = {
      providerJobId: prediction.id,
      imageUrl,
      status: prediction.status,
    };

    if (prediction.status === 'succeeded') {
      return {
        ...baseJob,
        result: {
          description: extractDescriptionText(prediction.output),
          imageUrl,
        },
      };
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return {
        ...baseJob,
        error: new Error(
          prediction.error
          || (prediction.status === 'canceled'
            ? 'Replicate prediction was canceled'
            : 'Replicate prediction failed'),
        ),
      };
    }

    return baseJob;
  }

  async createPrediction(imageUrl) {
    const prediction = await this.replicate.predictions.create({
      version: this.modelVersion,
      input: { image: imageUrl },
    });

    this.logger.info({
      imageUrl,
      predictionId: prediction.id,
      provider: 'replicate',
      modelRef: this.buildModelRef(),
      status: prediction.status,
    }, 'Replicate prediction created');

    return prediction;
  }

  async waitForPrediction(predictionId, imageUrl, timeoutMs) {
    return this.pollPredictionUntilDeadline({
      deadline: Date.now() + timeoutMs,
      imageUrl,
      predictionId,
      timeoutMs,
    });
  }

  async pollPredictionUntilDeadline({
    deadline,
    imageUrl,
    predictionId,
    timeoutMs,
  }) {
    const prediction = await this.replicate.predictions.get(predictionId);
    if (TERMINAL_STATUSES.has(prediction.status)) {
      return this.constructor.normalizePrediction(prediction, imageUrl);
    }

    if (Date.now() >= deadline) {
      await this.cancelPrediction(predictionId, imageUrl);
      throw new ProviderTimeoutError({
        provider: 'replicate',
        message: `Replicate prediction exceeded ${timeoutMs}ms`,
        timeoutMs,
        imageUrl,
        providerJobId: predictionId,
        modelRef: this.buildModelRef(),
      });
    }

    const remainingMs = deadline - Date.now();
    await this.sleep(Math.min(this.pollIntervalMs, remainingMs));
    return this.pollPredictionUntilDeadline({
      deadline,
      imageUrl,
      predictionId,
      timeoutMs,
    });
  }

  logFailure(error, imageUrl, providerJobId) {
    this.logger.error({
      err: error,
      provider: 'replicate',
      imageUrl,
      providerJobId,
      modelRef: this.buildModelRef(),
      upstream: getUpstreamErrorSummary(error),
    }, 'Replicate prediction failed');
  }

  async createDescriptionJob(imageUrl) {
    try {
      const prediction = await this.createPrediction(imageUrl);
      return this.constructor.normalizePrediction(prediction, imageUrl);
    } catch (error) {
      this.logFailure(error, imageUrl);
      throw error;
    }
  }

  async getDescriptionJob(providerJobId, imageUrl) {
    try {
      const prediction = await this.replicate.predictions.get(providerJobId);
      return this.constructor.normalizePrediction(prediction, imageUrl);
    } catch (error) {
      this.logFailure(error, imageUrl, providerJobId);
      throw error;
    }
  }

  /**
   * Generates an alt-text description for a single image URL.
   * Errors propagate to the caller — no silent swallowing.
   * @param {string} imageUrl
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<{ description: string, imageUrl: string }>}
   */
  async describeImage(imageUrl, options = {}) {
    const timeoutMs = toPositiveIntegerOrFallback(options.timeoutMs, this.requestTimeoutMs);
    this.logger.info({ imageUrl, modelRef: this.buildModelRef() }, 'Generating alt text');

    try {
      const prediction = await this.createPrediction(imageUrl);
      const resolvedPrediction = await this.waitForPrediction(
        prediction.id,
        imageUrl,
        timeoutMs,
      );

      if (!resolvedPrediction.result) {
        throw new Error('Replicate prediction finished without a result');
      }

      this.logger.debug({ imageUrl, predictionId: prediction.id }, 'Alt text generated');
      return resolvedPrediction.result;
    } catch (error) {
      this.logFailure(error, imageUrl);
      throw error;
    }
  }
}

module.exports = ReplicateDescriberService;
