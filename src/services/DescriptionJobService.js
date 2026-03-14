const crypto = require('node:crypto');

const DEFAULT_PENDING_STATUSES = new Set(['pending', 'processing', 'starting']);
const DEFAULT_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isPendingStatus = (status) => DEFAULT_PENDING_STATUSES.has(status);
const isTerminalStatus = (status) => DEFAULT_TERMINAL_STATUSES.has(status);

class DescriptionJobService {
  /**
   * @param {object} deps
   * @param {object} deps.imageDescriberFactory
   * @param {object} deps.jobStore
   * @param {object} deps.logger
   * @param {number} deps.waitTimeoutMs
   * @param {number} deps.pollIntervalMs
   * @param {number} deps.pendingTtlMs
   * @param {number} deps.completedTtlMs
   * @param {number} deps.failedTtlMs
   * @param {Function} [deps.sleep]
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
    this.sleep = wait;
  }

  static buildJobId({ model, imageUrl }) {
    return crypto
      .createHash('sha256')
      .update(`${model}\n${imageUrl}`)
      .digest('hex');
  }

  static supportsAsyncJobs(describer) {
    return typeof describer?.createDescriptionJob === 'function'
      && typeof describer?.getDescriptionJob === 'function';
  }

  static buildStatusUrl(jobId) {
    return `/api/v1/accessibility/description-jobs/${jobId}`;
  }

  buildJobResponse(job) {
    return {
      jobId: job.id,
      model: job.model,
      imageUrl: job.imageUrl,
      status: job.status,
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(isPendingStatus(job.status) ? {
        pollAfterMs: this.pollIntervalMs,
        statusUrl: this.constructor.buildStatusUrl(job.id),
      } : {}),
    };
  }

  static buildExpirationIso(ttlMs) {
    return new Date(Date.now() + ttlMs).toISOString();
  }

  async saveJob(job) {
    await this.jobStore.set(job);
    return job;
  }

  async buildSucceededJob(existingJob, result) {
    return this.saveJob({
      ...existingJob,
      status: 'succeeded',
      result,
      error: undefined,
      updatedAt: new Date().toISOString(),
      expiresAt: this.constructor.buildExpirationIso(this.completedTtlMs),
    });
  }

  async buildFailedJob(existingJob, error) {
    return this.saveJob({
      ...existingJob,
      status: 'failed',
      result: undefined,
      error: {
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
      },
      updatedAt: new Date().toISOString(),
      expiresAt: this.constructor.buildExpirationIso(this.failedTtlMs),
    });
  }

  async buildPendingJob({
    id,
    imageUrl,
    model,
    providerJobId,
    status,
  }) {
    const timestamp = new Date().toISOString();

    return this.saveJob({
      id,
      imageUrl,
      model,
      providerJobId,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: this.constructor.buildExpirationIso(this.pendingTtlMs),
    });
  }

  async refreshJob(job, describer) {
    const providerJob = await describer.getDescriptionJob(job.providerJobId, job.imageUrl);

    if (providerJob.status === 'succeeded') {
      return this.buildSucceededJob(job, providerJob.result);
    }

    if (providerJob.status === 'failed' || providerJob.status === 'canceled') {
      const error = providerJob.error ?? new Error('Description job failed');
      return this.buildFailedJob(job, error);
    }

    return this.saveJob({
      ...job,
      status: providerJob.status,
      updatedAt: new Date().toISOString(),
      expiresAt: this.constructor.buildExpirationIso(this.pendingTtlMs),
    });
  }

  async waitForJob(job, describer, waitTimeoutMs) {
    return this.pollJobUntilDeadline(job, describer, Date.now() + waitTimeoutMs);
  }

  async pollJobUntilDeadline(job, describer, deadline) {
    if (Date.now() >= deadline) {
      return job;
    }

    const refreshedJob = await this.refreshJob(job, describer);
    if (isTerminalStatus(refreshedJob.status)) {
      return refreshedJob;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return refreshedJob;
    }

    await this.sleep(Math.min(this.pollIntervalMs, remainingMs));
    return this.pollJobUntilDeadline(refreshedJob, describer, deadline);
  }

  async resolveDescription({ model, imageUrl }) {
    const describer = this.imageDescriberFactory.get(model);
    const jobId = this.constructor.buildJobId({ model, imageUrl });
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
        createdAt: new Date().toISOString(),
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
