const crypto = require('node:crypto');

const DEFAULT_PENDING_STATUSES = new Set(['pending', 'processing', 'starting']);
const DEFAULT_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * @param {string} status
 * @returns {boolean}
 */
const isPendingStatus = (status) => DEFAULT_PENDING_STATUSES.has(status);
/**
 * @param {string} status
 * @returns {boolean}
 */
const isTerminalStatus = (status) => DEFAULT_TERMINAL_STATUSES.has(status);

/**
 * @typedef {object} JobError
 * @property {string} message
 * @property {string} [code]
 */

/**
 * @typedef {object} Job
 * @property {string} id
 * @property {string} imageUrl
 * @property {string} model
 * @property {string} status
 * @property {string} [providerJobId]
 * @property {unknown} [result]
 * @property {JobError} [error]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {string} [expiresAt]
 */

/**
 * A partial job used to seed job construction; status is always set by the
 * builder that consumes it.
 * @typedef {Partial<Job> & { id: string, imageUrl: string, model: string }} JobSeed
 */

/**
 * @typedef {object} ProviderJob
 * @property {string} status
 * @property {string} providerJobId
 * @property {unknown} [result]
 * @property {Error & { code?: string }} [error]
 */

/**
 * @typedef {object} Describer
 * @property {(imageSource: string) => Promise<ProviderJob>} createDescriptionJob
 * @property {(providerJobId: string, imageSource: string) => Promise<ProviderJob>} getDescriptionJob
 */

/**
 * @typedef {object} JobStore
 * @property {(jobId: string) => Promise<Job | null>} get
 * @property {(job: Job) => Promise<unknown>} set
 */

/**
 * @typedef {object} ImageDescriberFactory
 * @property {(model: string) => Describer} get
 */

/**
 * @typedef {{ kind: 'completed', result: unknown, job: Job } | { kind: 'pending', job: Job }} ResolveDescriptionResult
 */

class DescriptionJobService {
  /**
   * @param {object} deps
   * @param {ImageDescriberFactory} deps.imageDescriberFactory
   * @param {JobStore} deps.jobStore
   * @param {object} deps.logger
   * @param {number} deps.waitTimeoutMs
   * @param {number} deps.pollIntervalMs
   * @param {number} deps.pendingTtlMs
   * @param {number} deps.completedTtlMs
   * @param {number} deps.failedTtlMs
   * @param {() => number} [deps.now]
   * @param {(ms: number) => Promise<void>} [deps.sleep]
   */
  constructor({
    imageDescriberFactory,
    jobStore,
    logger,
    waitTimeoutMs,
    pollIntervalMs,
    pendingTtlMs,
    completedTtlMs,
    failedTtlMs,
    now: nowFn = Date.now,
    sleep: wait = sleep,
  }) {
    this.imageDescriberFactory = imageDescriberFactory;
    this.jobStore = jobStore;
    this.logger = logger;
    this.waitTimeoutMs = waitTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.pendingTtlMs = pendingTtlMs;
    this.completedTtlMs = completedTtlMs;
    this.failedTtlMs = failedTtlMs;
    this.now = nowFn;
    this.sleep = wait;
  }

  /**
   * @param {{ model: string, imageUrl: string }} params
   * @returns {string}
   */
  static buildJobId({ model, imageUrl }) {
    return crypto
      .createHash('sha256')
      .update(`${model}\n${imageUrl}`)
      .digest('hex');
  }

  /**
   * @param {Record<string, unknown> | null | undefined} describer
   * @returns {boolean}
   */
  static supportsAsyncJobs(describer) {
    return typeof describer?.createDescriptionJob === 'function'
      && typeof describer?.getDescriptionJob === 'function';
  }

  /**
   * @param {string} jobId
   * @returns {string}
   */
  static buildStatusUrl(jobId) {
    return `/api/v1/accessibility/description-jobs/${jobId}`;
  }

  /**
   * @param {Job} job
   */
  buildJobResponse(job) {
    return {
      jobId: job.id,
      model: job.model,
      imageUrl: job.imageUrl,
      status: job.status,
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(isPendingStatus(job.status)
        ? {
            pollAfterMs: this.pollIntervalMs,
            statusUrl: (/** @type {typeof DescriptionJobService} */ (this.constructor)).buildStatusUrl(job.id),
          }
        : {}),
    };
  }

  /**
   * @param {number} ttlMs
   * @param {number} [nowEpochMs]
   * @returns {string}
   */
  static buildExpirationIso(ttlMs, nowEpochMs = Date.now()) {
    return new Date(nowEpochMs + ttlMs).toISOString();
  }

  buildTimestampIso(nowEpochMs = this.now()) {
    return new Date(nowEpochMs).toISOString();
  }

  /**
   * @param {Job} job
   * @returns {Promise<Job>}
   */
  async saveJob(job) {
    await this.jobStore.set(job);
    return job;
  }

  /**
   * @param {JobSeed} existingJob
   * @param {unknown} result
   * @returns {Promise<Job>}
   */
  async buildSucceededJob(existingJob, result) {
    const nowEpochMs = this.now();

    return this.saveJob({
      ...existingJob,
      status: 'succeeded',
      result,
      error: undefined,
      updatedAt: this.buildTimestampIso(nowEpochMs),
      expiresAt: (/** @type {typeof DescriptionJobService} */ (this.constructor)).buildExpirationIso(this.completedTtlMs, nowEpochMs),
    });
  }

  /**
   * @param {Job} existingJob
   * @param {Error & { code?: string }} error
   * @returns {Promise<Job>}
   */
  async buildFailedJob(existingJob, error) {
    const nowEpochMs = this.now();

    return this.saveJob({
      ...existingJob,
      status: 'failed',
      result: undefined,
      error: {
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
      },
      updatedAt: this.buildTimestampIso(nowEpochMs),
      expiresAt: (/** @type {typeof DescriptionJobService} */ (this.constructor)).buildExpirationIso(this.failedTtlMs, nowEpochMs),
    });
  }

  /**
   * @param {{ id: string, imageUrl: string, model: string, providerJobId: string, status: string }} params
   * @returns {Promise<Job>}
   */
  async buildPendingJob({
    id,
    imageUrl,
    model,
    providerJobId,
    status,
  }) {
    const nowEpochMs = this.now();
    const timestamp = this.buildTimestampIso(nowEpochMs);

    return this.saveJob({
      id,
      imageUrl,
      model,
      providerJobId,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: (/** @type {typeof DescriptionJobService} */ (this.constructor)).buildExpirationIso(this.pendingTtlMs, nowEpochMs),
    });
  }

  /**
   * @param {Job} job
   * @param {Describer} describer
   * @returns {Promise<Job>}
   */
  async refreshJob(job, describer) {
    const providerJob = await describer.getDescriptionJob(
      /** @type {string} */ (job.providerJobId),
      job.imageUrl,
    );

    if (providerJob.status === 'succeeded') {
      return this.buildSucceededJob(job, providerJob.result);
    }

    if (providerJob.status === 'failed' || providerJob.status === 'canceled') {
      const error = providerJob.error ?? new Error('Description job failed');
      return this.buildFailedJob(job, error);
    }

    const nowEpochMs = this.now();

    return this.saveJob({
      ...job,
      status: providerJob.status,
      updatedAt: this.buildTimestampIso(nowEpochMs),
      expiresAt: (/** @type {typeof DescriptionJobService} */ (this.constructor)).buildExpirationIso(this.pendingTtlMs, nowEpochMs),
    });
  }

  /**
   * @param {Job} job
   * @param {Describer} describer
   * @param {number} waitTimeoutMs
   * @returns {Promise<Job>}
   */
  async waitForJob(job, describer, waitTimeoutMs) {
    return this.pollJobUntilDeadline(job, describer, this.now() + waitTimeoutMs);
  }

  /**
   * @param {Job} job
   * @param {Describer} describer
   * @param {number} deadline
   * @returns {Promise<Job>}
   */
  async pollJobUntilDeadline(job, describer, deadline) {
    if (this.now() >= deadline) {
      return job;
    }

    const refreshedJob = await this.refreshJob(job, describer);
    if (isTerminalStatus(refreshedJob.status)) {
      return refreshedJob;
    }

    const remainingMs = deadline - this.now();
    if (remainingMs <= 0) {
      return refreshedJob;
    }

    await this.sleep(Math.min(this.pollIntervalMs, remainingMs));
    return this.pollJobUntilDeadline(refreshedJob, describer, deadline);
  }

  /**
   * @param {{ model: string, imageUrl: string }} params
   * @returns {Promise<ResolveDescriptionResult>}
   */
  async resolveDescription({ model, imageUrl }) {
    const describer = this.imageDescriberFactory.get(model);
    const jobId = (/** @type {typeof DescriptionJobService} */ (this.constructor)).buildJobId({ model, imageUrl });
    const existingJob = await this.jobStore.get(jobId);

    if (existingJob?.status === 'succeeded' && existingJob.result) {
      return {
        kind: 'completed',
        result: existingJob.result,
        job: existingJob,
      };
    }

    if (existingJob && isPendingStatus(existingJob.status)) {
      const pendingJob = await this.waitForJob(existingJob, describer, this.waitTimeoutMs);

      if (pendingJob.status === 'succeeded' && pendingJob.result) {
        return {
          kind: 'completed',
          result: pendingJob.result,
          job: pendingJob,
        };
      }

      return {
        kind: 'pending',
        job: pendingJob,
      };
    }

    const providerJob = await describer.createDescriptionJob(imageUrl);
    if (providerJob.status === 'succeeded') {
      const completedJob = await this.buildSucceededJob({
        id: jobId,
        imageUrl,
        model,
        providerJobId: providerJob.providerJobId,
        createdAt: this.buildTimestampIso(),
      }, providerJob.result);

      return {
        kind: 'completed',
        result: completedJob.result,
        job: completedJob,
      };
    }

    if (providerJob.status === 'failed' || providerJob.status === 'canceled') {
      throw providerJob.error ?? new Error('Description job failed');
    }

    const pendingJob = await this.buildPendingJob({
      id: jobId,
      imageUrl,
      model,
      providerJobId: providerJob.providerJobId,
      status: providerJob.status,
    });
    const maybeCompletedJob = await this.waitForJob(pendingJob, describer, this.waitTimeoutMs);

    if (maybeCompletedJob.status === 'succeeded' && maybeCompletedJob.result) {
      return {
        kind: 'completed',
        result: maybeCompletedJob.result,
        job: maybeCompletedJob,
      };
    }

    return {
      kind: 'pending',
      job: maybeCompletedJob,
    };
  }

  /**
   * @param {string} jobId
   * @returns {Promise<Job | null>}
   */
  async getJobStatus(jobId) {
    const job = await this.jobStore.get(jobId);
    if (!job) {
      return null;
    }

    if (job.status === 'succeeded' || job.status === 'failed') {
      return job;
    }

    const describer = this.imageDescriberFactory.get(job.model);
    return this.refreshJob(job, describer);
  }
}

module.exports = {
  DescriptionJobService,
  isPendingStatus,
  isTerminalStatus,
};
