const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');
const { ProviderTimeoutError } = require('../errors/ProviderTimeoutError');

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

/**
 * @typedef {object} Logger
 * @property {(...args: unknown[]) => void} info
 * @property {(...args: unknown[]) => void} debug
 * @property {(...args: unknown[]) => void} error
 * @property {(...args: unknown[]) => void} [warn]
 */

/**
 * @typedef {object} ProviderConfig
 * @property {string} [modelOwner]
 * @property {string} [modelName]
 * @property {string} [modelVersion]
 * @property {number} [requestTimeoutMs]
 * @property {number} [pollIntervalMs]
 */

/**
 * @typedef {object} RequestOptions
 * @property {number} [timeout]
 */

/**
 * @typedef {object} Prediction
 * @property {string} id
 * @property {string} status
 * @property {unknown} [output]
 * @property {string} [error]
 */

/**
 * @typedef {object} ReplicateClient
 * @property {{ cancel: (id: string) => Promise<unknown>, create: (input: unknown) => Promise<Prediction>, get: (id: string) => Promise<Prediction> }} predictions
 */

/**
 * @typedef {object} ProviderJob
 * @property {string} providerJobId
 * @property {string} imageUrl
 * @property {string} status
 * @property {{ description: string, imageUrl: string }} [result]
 * @property {Error} [error]
 */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const toPositiveIntegerOrFallback = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

/**
 * @param {unknown} output
 * @returns {string}
 */
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
   * @param {Logger} deps.logger - pino logger instance
   * @param {ReplicateClient} deps.replicateClient - instantiated Replicate SDK client
   * @param {ProviderConfig} deps.providerConfig - provider config section
   * @param {RequestOptions} [deps.requestOptions]
   * @param {() => number} [deps.now]
   * @param {(ms: number) => Promise<void>} [deps.sleep]
   */
  constructor({
    logger,
    replicateClient,
    providerConfig,
    requestOptions = {},
    now: nowFn = Date.now,
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
    this.now = nowFn;
    this.sleep = wait;
    this.supportsAsyncJobs = true;
  }

  buildModelRef() {
    return `${this.modelOwner}/${this.modelName}:${this.modelVersion}`;
  }

  /**
   * @param {string} predictionId
   * @param {string} imageUrl
   * @returns {Promise<void>}
   */
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

  /**
   * @param {Prediction} prediction
   * @param {string} imageUrl
   * @returns {ProviderJob}
   */
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

  /**
   * @param {string} imageUrl
   * @returns {Promise<Prediction>}
   */
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

  /**
   * @param {string} predictionId
   * @param {string} imageUrl
   * @param {number} timeoutMs
   * @returns {Promise<ProviderJob>}
   */
  async waitForPrediction(predictionId, imageUrl, timeoutMs) {
    return this.pollPredictionUntilDeadline({
      deadline: this.now() + timeoutMs,
      imageUrl,
      predictionId,
      timeoutMs,
    });
  }

  /**
   * @param {{ deadline: number, imageUrl: string, predictionId: string, timeoutMs: number }} params
   * @returns {Promise<ProviderJob>}
   */
  async pollPredictionUntilDeadline({
    deadline,
    imageUrl,
    predictionId,
    timeoutMs,
  }) {
    const prediction = await this.replicate.predictions.get(predictionId);
    if (TERMINAL_STATUSES.has(prediction.status)) {
      return (/** @type {typeof ReplicateDescriberService} */ (this.constructor)).normalizePrediction(prediction, imageUrl);
    }

    if (this.now() >= deadline) {
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

    const remainingMs = deadline - this.now();
    await this.sleep(Math.min(this.pollIntervalMs, remainingMs));
    return this.pollPredictionUntilDeadline({
      deadline,
      imageUrl,
      predictionId,
      timeoutMs,
    });
  }

  /**
   * @param {unknown} error
   * @param {string} imageUrl
   * @param {string} [providerJobId]
   * @returns {void}
   */
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

  /**
   * @param {unknown} error
   * @returns {boolean}
   */
  shouldSkipDescriptionError(error) {
    const rawMessage = (/** @type {{ message?: unknown }} */ (error))?.message;
    const message = typeof rawMessage === 'string' ? rawMessage.toLowerCase() : '';
    const mentionsImageSource = message.includes('image') || message.includes('url');
    const isImageSourceFailure = [
      'download',
      'fetch',
      'invalid',
      'not found',
      'open',
      'read',
      'unsupported',
      'unable',
    ].some((term) => message.includes(term));

    return mentionsImageSource && isImageSourceFailure;
  }

  /**
   * @param {string} imageUrl
   * @returns {Promise<ProviderJob>}
   */
  async createDescriptionJob(imageUrl) {
    try {
      const prediction = await this.createPrediction(imageUrl);
      return (/** @type {typeof ReplicateDescriberService} */ (this.constructor)).normalizePrediction(prediction, imageUrl);
    } catch (error) {
      this.logFailure(error, imageUrl);
      throw error;
    }
  }

  /**
   * @param {string} providerJobId
   * @param {string} imageUrl
   * @returns {Promise<ProviderJob>}
   */
  async getDescriptionJob(providerJobId, imageUrl) {
    try {
      const prediction = await this.replicate.predictions.get(providerJobId);
      return (/** @type {typeof ReplicateDescriberService} */ (this.constructor)).normalizePrediction(prediction, imageUrl);
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
