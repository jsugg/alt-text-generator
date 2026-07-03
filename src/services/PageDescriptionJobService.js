const crypto = require('node:crypto');

const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');
const {
  isPendingStatus,
  isTerminalStatus,
} = require('./DescriptionJobService');

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * @typedef {object} JobError
 * @property {string} message
 * @property {string} [code]
 */

/**
 * @typedef {object} PageJob
 * @property {string} id
 * @property {string} model
 * @property {string} pageUrl
 * @property {string} status
 * @property {string} [jobType]
 * @property {unknown} [result]
 * @property {JobError} [error]
 * @property {string} [runnerId]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {string} [expiresAt]
 * @property {string} [leaseExpiresAt]
 * @property {number} [leaseExpiresAtEpochMs]
 */

/**
 * @typedef {object} DescriptionJob
 * @property {string} id
 * @property {string} status
 * @property {unknown} [result]
 * @property {JobError} [error]
 */

/**
 * @typedef {object} JobStore
 * @property {(jobId: string) => Promise<PageJob | null>} get
 * @property {(job: PageJob) => Promise<unknown>} set
 * @property {(jobId: string, runnerId: string, ttlMs: number) => Promise<PageJob | null>} [claim]
 */

/**
 * @typedef {object} Logger
 * @property {(...args: unknown[]) => void} [info]
 * @property {(...args: unknown[]) => void} [warn]
 * @property {(...args: unknown[]) => void} [error]
 * @property {(...args: unknown[]) => void} [debug]
 */

/**
 * @typedef {object} PageDescriptionServiceLike
 * @property {(params: { pageUrl: string, model: string, describeImage: (imageUrl: string) => Promise<unknown> }) => Promise<unknown>} describePageWithResolver
 * @property {(params: { pageUrl: string, model: string }) => Promise<unknown>} describePageWithAsyncJobs
 */

/**
 * @typedef {object} DescriptionJobServiceLike
 * @property {(params: { model: string, imageUrl: string }) => Promise<{ kind: string, result?: unknown, job?: DescriptionJob }>} resolveDescription
 * @property {(jobId: string) => Promise<DescriptionJob | null>} getJobStatus
 */

/**
 * @typedef {{ kind: 'completed', result: unknown, job: PageJob } | { kind: 'pending', job: PageJob }} PageResolveResult
 */

class PageDescriptionJobService {
  /**
   * @param {object} deps
   * @param {PageDescriptionServiceLike} deps.pageDescriptionService
   * @param {DescriptionJobServiceLike} [deps.descriptionJobService]
   * @param {JobStore} deps.jobStore
   * @param {Logger} deps.logger
   * @param {number} deps.waitTimeoutMs
   * @param {number} deps.pollIntervalMs
   * @param {number} deps.pendingTtlMs
   * @param {number} deps.completedTtlMs
   * @param {number} deps.failedTtlMs
   * @param {number} deps.claimTtlMs
   * @param {() => number} [deps.now]
   * @param {(ms: number) => Promise<void>} [deps.sleep]
   * @param {Function} [deps.setInterval]
   * @param {Function} [deps.clearInterval]
   * @param {string} [deps.runnerId]
   */
  constructor({
    pageDescriptionService,
    descriptionJobService,
    jobStore,
    logger,
    waitTimeoutMs,
    pollIntervalMs,
    pendingTtlMs,
    completedTtlMs,
    failedTtlMs,
    claimTtlMs,
    now: nowFn = Date.now,
    sleep: wait = sleep,
    setInterval: scheduleInterval = setInterval,
    clearInterval: cancelInterval = clearInterval,
    runnerId = crypto.randomUUID(),
  }) {
    this.pageDescriptionService = pageDescriptionService;
    this.descriptionJobService = descriptionJobService;
    this.jobStore = jobStore;
    this.logger = logger;
    this.waitTimeoutMs = waitTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.pendingTtlMs = pendingTtlMs;
    this.completedTtlMs = completedTtlMs;
    this.failedTtlMs = failedTtlMs;
    this.claimTtlMs = claimTtlMs;
    this.now = nowFn;
    this.sleep = wait;
    this.setInterval = scheduleInterval;
    this.clearInterval = cancelInterval;
    this.runnerId = runnerId;
    this.activeJobs = new Map();
    this.leaseRefreshIntervalMs = Math.max(
      Math.floor(this.claimTtlMs / 2),
      Math.min(this.pollIntervalMs, 1000),
      250,
    );
  }

  /**
   * @param {{ model: string, pageUrl: string }} params
   * @returns {string}
   */
  static buildJobId({ model, pageUrl }) {
    return crypto
      .createHash('sha256')
      .update(`page-description\n${model}\n${pageUrl}`)
      .digest('hex');
  }

  /**
   * @param {string} jobId
   * @returns {string}
   */
  static buildStatusUrl(jobId) {
    return `/api/v1/accessibility/page-description-jobs/${jobId}`;
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
   * @param {PageJob} job
   */
  buildJobResponse(job) {
    return {
      jobId: job.id,
      model: job.model,
      pageUrl: job.pageUrl,
      status: job.status,
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(isPendingStatus(job.status)
        ? {
            pollAfterMs: this.pollIntervalMs,
            statusUrl: (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildStatusUrl(job.id),
          }
        : {}),
    };
  }

  /**
   * @param {PageJob} job
   * @returns {Promise<PageJob>}
   */
  async saveJob(job) {
    await this.jobStore.set(job);
    return job;
  }

  /**
   * @param {{ id: string, model: string, pageUrl: string }} params
   * @returns {Promise<PageJob>}
   */
  async buildPendingJob({ id, model, pageUrl }) {
    const nowEpochMs = this.now();
    const timestamp = this.buildTimestampIso(nowEpochMs);

    return this.saveJob({
      id,
      jobType: 'page-description',
      model,
      pageUrl,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildExpirationIso(this.pendingTtlMs, nowEpochMs),
    });
  }

  /**
   * @param {PageJob} job
   * @returns {Promise<PageJob>}
   */
  async buildProcessingJob(job) {
    const nowEpochMs = this.now();

    return this.saveJob({
      ...job,
      status: 'processing',
      runnerId: this.runnerId,
      updatedAt: this.buildTimestampIso(nowEpochMs),
      expiresAt: (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildExpirationIso(this.pendingTtlMs, nowEpochMs),
    });
  }

  /**
   * @param {PageJob} job
   * @param {unknown} result
   * @returns {Promise<PageJob>}
   */
  async buildSucceededJob(job, result) {
    const nowEpochMs = this.now();

    return this.saveJob({
      ...job,
      status: 'succeeded',
      result,
      error: undefined,
      runnerId: undefined,
      leaseExpiresAt: undefined,
      leaseExpiresAtEpochMs: undefined,
      updatedAt: this.buildTimestampIso(nowEpochMs),
      expiresAt: (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildExpirationIso(this.completedTtlMs, nowEpochMs),
    });
  }

  /**
   * @param {PageJob} job
   * @param {unknown} error
   * @returns {Promise<PageJob>}
   */
  async buildFailedJob(job, error) {
    const nowEpochMs = this.now();
    const failure = /** @type {Error & { code?: string }} */ (error);

    return this.saveJob({
      ...job,
      status: 'failed',
      result: undefined,
      error: {
        message: failure.message,
        ...(failure.code ? { code: failure.code } : {}),
      },
      runnerId: undefined,
      leaseExpiresAt: undefined,
      leaseExpiresAtEpochMs: undefined,
      updatedAt: this.buildTimestampIso(nowEpochMs),
      expiresAt: (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildExpirationIso(this.failedTtlMs, nowEpochMs),
    });
  }

  /**
   * @param {{ error?: { message?: string, code?: string } } | null | undefined} job
   * @returns {Error & { code?: string }}
   */
  static buildJobError(job) {
    const error = /** @type {Error & { code?: string }} */ (new Error(job?.error?.message ?? 'Page description job failed'));

    if (job?.error?.code) {
      error.code = job.error.code;
    }

    return error;
  }

  /**
   * @param {{ error?: { message?: string, code?: string } } | null | undefined} job
   * @returns {Error & { code?: string }}
   */
  static buildDescriptionJobError(job) {
    const error = /** @type {Error & { code?: string }} */ (new Error(job?.error?.message ?? 'Description job failed'));

    if (job?.error?.code) {
      error.code = job.error.code;
    }

    return error;
  }

  /**
   * @param {string} jobId
   * @returns {Promise<PageJob | null>}
   */
  async claimJob(jobId) {
    if (typeof this.jobStore.claim === 'function') {
      return this.jobStore.claim(jobId, this.runnerId, this.claimTtlMs);
    }

    return this.jobStore.get(jobId);
  }

  /**
   * @param {string} jobId
   * @returns {Promise<PageJob | null>}
   */
  async refreshJobLease(jobId) {
    const claimedJob = await this.claimJob(jobId);

    if (!claimedJob) {
      return null;
    }

    return this.buildProcessingJob(claimedJob);
  }

  /**
   * @param {string} jobId
   */
  startLeaseHeartbeat(jobId) {
    const intervalHandle = this.setInterval(() => {
      this.refreshJobLease(jobId).catch((error) => {
        this.logger.warn?.({
          err: error,
          jobId,
          runnerId: this.runnerId,
          upstream: getUpstreamErrorSummary(error),
        }, 'Failed to refresh page-description job lease');
      });
    }, this.leaseRefreshIntervalMs);

    intervalHandle.unref?.();
    return intervalHandle;
  }

  /**
   * @param {{ imageUrl: string, model: string }} params
   * @returns {Promise<unknown>}
   */
  async resolveImageDescription({ imageUrl, model }) {
    const descriptionJobService = /** @type {DescriptionJobServiceLike} */ (this.descriptionJobService);
    const outcome = await descriptionJobService.resolveDescription({
      model,
      imageUrl,
    });

    if (outcome.kind === 'completed') {
      return outcome.result;
    }

    /**
     * @param {DescriptionJob | null | undefined} descriptionJob
     * @returns {Promise<DescriptionJob | null | undefined>}
     */
    const waitForTerminalDescriptionJob = async (descriptionJob) => {
      if (!descriptionJob || !isPendingStatus(descriptionJob.status)) {
        return descriptionJob;
      }

      await this.sleep(this.pollIntervalMs);
      const refreshedJob = await descriptionJobService.getJobStatus(descriptionJob.id);
      return waitForTerminalDescriptionJob(refreshedJob);
    };

    const descriptionJob = await waitForTerminalDescriptionJob(outcome.job);

    if (descriptionJob?.status === 'succeeded' && descriptionJob.result) {
      return descriptionJob.result;
    }

    throw (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildDescriptionJobError(descriptionJob);
  }

  /**
   * @param {PageJob} job
   * @returns {Promise<void>}
   */
  async runJob(job) {
    let heartbeat;

    try {
      const processingJob = await this.buildProcessingJob(job);
      heartbeat = this.startLeaseHeartbeat(job.id);

      this.logger.info?.({
        jobId: processingJob.id,
        model: processingJob.model,
        pageUrl: processingJob.pageUrl,
      }, 'Running page-description job');

      const result = this.descriptionJobService
        ? await this.pageDescriptionService.describePageWithResolver({
            pageUrl: processingJob.pageUrl,
            model: processingJob.model,
            describeImage: (imageUrl) => this.resolveImageDescription({
              model: processingJob.model,
              imageUrl,
            }),
          })
        : await this.pageDescriptionService.describePageWithAsyncJobs({
            pageUrl: processingJob.pageUrl,
            model: processingJob.model,
          });

      await this.buildSucceededJob(processingJob, result);
      this.logger.info?.({
        jobId: processingJob.id,
        model: processingJob.model,
        pageUrl: processingJob.pageUrl,
      }, 'Completed page-description job');
    } catch (error) {
      const currentJob = await this.jobStore.get(job.id) ?? job;
      await this.buildFailedJob(currentJob, error);
      this.logger.error?.({
        err: error,
        jobId: job.id,
        model: job.model,
        pageUrl: job.pageUrl,
        upstream: getUpstreamErrorSummary(error),
      }, 'Page-description job failed');
    } finally {
      if (heartbeat) {
        this.clearInterval(heartbeat);
      }
    }
  }

  /**
   * @param {PageJob} job
   * @returns {Promise<boolean>}
   */
  async ensureExecution(job) {
    if (isTerminalStatus(job.status)) {
      return false;
    }

    if (this.activeJobs.has(job.id)) {
      return false;
    }

    const claimedJob = await this.claimJob(job.id);
    if (!claimedJob) {
      return false;
    }

    const execution = this.runJob(claimedJob).finally(() => {
      this.activeJobs.delete(job.id);
    });

    this.activeJobs.set(job.id, execution);
    return true;
  }

  /**
   * @param {string} jobId
   * @param {number} waitTimeoutMs
   * @returns {Promise<PageJob | null>}
   */
  async waitForJob(jobId, waitTimeoutMs) {
    return this.pollJobUntilDeadline(jobId, this.now() + waitTimeoutMs);
  }

  /**
   * @param {string} jobId
   * @param {number} deadline
   * @returns {Promise<PageJob | null>}
   */
  async pollJobUntilDeadline(jobId, deadline) {
    const job = await this.jobStore.get(jobId);

    if (!job || isTerminalStatus(job.status) || this.now() >= deadline) {
      return job;
    }

    await this.ensureExecution(job);

    const remainingMs = deadline - this.now();
    if (remainingMs <= 0) {
      return this.jobStore.get(jobId);
    }

    await this.sleep(Math.min(this.pollIntervalMs, remainingMs));
    return this.pollJobUntilDeadline(jobId, deadline);
  }

  /**
   * @param {{ model: string, pageUrl: string }} params
   * @returns {Promise<PageResolveResult>}
   */
  async resolvePageDescription({ model, pageUrl }) {
    const jobId = (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildJobId({ model, pageUrl });
    const existingJob = await this.jobStore.get(jobId);

    if (existingJob?.status === 'succeeded' && existingJob.result) {
      return {
        kind: 'completed',
        result: existingJob.result,
        job: existingJob,
      };
    }

    if (existingJob && isPendingStatus(existingJob.status)) {
      await this.ensureExecution(existingJob);
      const pendingJob = await this.waitForJob(jobId, this.waitTimeoutMs);

      if (pendingJob?.status === 'succeeded' && pendingJob.result) {
        return {
          kind: 'completed',
          result: pendingJob.result,
          job: pendingJob,
        };
      }

      if (pendingJob?.status === 'failed' || pendingJob?.status === 'canceled') {
        throw (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildJobError(pendingJob);
      }

      return {
        kind: 'pending',
        job: pendingJob ?? existingJob,
      };
    }

    const pendingJob = await this.buildPendingJob({
      id: jobId,
      model,
      pageUrl,
    });
    await this.ensureExecution(pendingJob);
    const maybeCompletedJob = await this.waitForJob(jobId, this.waitTimeoutMs);

    if (maybeCompletedJob?.status === 'succeeded' && maybeCompletedJob.result) {
      return {
        kind: 'completed',
        result: maybeCompletedJob.result,
        job: maybeCompletedJob,
      };
    }

    if (maybeCompletedJob?.status === 'failed' || maybeCompletedJob?.status === 'canceled') {
      throw (/** @type {typeof PageDescriptionJobService} */ (this.constructor)).buildJobError(maybeCompletedJob);
    }

    return {
      kind: 'pending',
      job: maybeCompletedJob ?? pendingJob,
    };
  }

  /**
   * @param {string} jobId
   * @returns {Promise<PageJob | null>}
   */
  async getJobStatus(jobId) {
    const job = await this.jobStore.get(jobId);

    if (!job) {
      return null;
    }

    if (isTerminalStatus(job.status)) {
      return job;
    }

    await this.ensureExecution(job);
    return (await this.jobStore.get(jobId)) ?? job;
  }
}

module.exports = {
  PageDescriptionJobService,
};
