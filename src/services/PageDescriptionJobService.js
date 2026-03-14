const crypto = require('node:crypto');

const { getUpstreamErrorSummary } = require('../utils/getUpstreamErrorSummary');
const {
  isPendingStatus,
  isTerminalStatus,
} = require('./DescriptionJobService');

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

class PageDescriptionJobService {
  /**
   * @param {object} deps
   * @param {object} deps.pageDescriptionService
   * @param {object} [deps.descriptionJobService]
   * @param {object} deps.jobStore
   * @param {object} deps.logger
   * @param {number} deps.waitTimeoutMs
   * @param {number} deps.pollIntervalMs
   * @param {number} deps.pendingTtlMs
   * @param {number} deps.completedTtlMs
   * @param {number} deps.failedTtlMs
   * @param {number} deps.claimTtlMs
   * @param {Function} [deps.sleep]
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
    sleep: wait = sleep,
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
    this.sleep = wait;
    this.runnerId = runnerId;
    this.activeJobs = new Map();
    this.leaseRefreshIntervalMs = Math.max(
      Math.floor(this.claimTtlMs / 2),
      Math.min(this.pollIntervalMs, 1000),
      250,
    );
  }

  static buildJobId({ model, pageUrl }) {
    return crypto
      .createHash('sha256')
      .update(`page-description\n${model}\n${pageUrl}`)
      .digest('hex');
  }

  static buildStatusUrl(jobId) {
    return `/api/v1/accessibility/page-description-jobs/${jobId}`;
  }

  static buildExpirationIso(ttlMs) {
    return new Date(Date.now() + ttlMs).toISOString();
  }

  buildJobResponse(job) {
    return {
      jobId: job.id,
      model: job.model,
      pageUrl: job.pageUrl,
      status: job.status,
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(isPendingStatus(job.status) ? {
        pollAfterMs: this.pollIntervalMs,
        statusUrl: this.constructor.buildStatusUrl(job.id),
      } : {}),
    };
  }

  async saveJob(job) {
    await this.jobStore.set(job);
    return job;
  }

  async buildPendingJob({ id, model, pageUrl }) {
    const timestamp = new Date().toISOString();

    return this.saveJob({
      id,
      jobType: 'page-description',
      model,
      pageUrl,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: this.constructor.buildExpirationIso(this.pendingTtlMs),
    });
  }

  async buildProcessingJob(job) {
    return this.saveJob({
      ...job,
      status: 'processing',
      runnerId: this.runnerId,
      updatedAt: new Date().toISOString(),
      expiresAt: this.constructor.buildExpirationIso(this.pendingTtlMs),
    });
  }

  async buildSucceededJob(job, result) {
    return this.saveJob({
      ...job,
      status: 'succeeded',
      result,
      error: undefined,
      runnerId: undefined,
      leaseExpiresAt: undefined,
      leaseExpiresAtEpochMs: undefined,
      updatedAt: new Date().toISOString(),
      expiresAt: this.constructor.buildExpirationIso(this.completedTtlMs),
    });
  }

  async buildFailedJob(job, error) {
    return this.saveJob({
      ...job,
      status: 'failed',
      result: undefined,
      error: {
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
      },
      runnerId: undefined,
      leaseExpiresAt: undefined,
      leaseExpiresAtEpochMs: undefined,
      updatedAt: new Date().toISOString(),
      expiresAt: this.constructor.buildExpirationIso(this.failedTtlMs),
    });
  }

  static buildJobError(job) {
    const error = new Error(job?.error?.message ?? 'Page description job failed');

    if (job?.error?.code) {
      error.code = job.error.code;
    }

    return error;
  }

  static buildDescriptionJobError(job) {
    const error = new Error(job?.error?.message ?? 'Description job failed');

    if (job?.error?.code) {
      error.code = job.error.code;
    }

    return error;
  }

  async claimJob(jobId) {
    if (typeof this.jobStore.claim === 'function') {
      return this.jobStore.claim(jobId, this.runnerId, this.claimTtlMs);
    }

    return this.jobStore.get(jobId);
  }

  async refreshJobLease(jobId) {
    const claimedJob = await this.claimJob(jobId);

    if (!claimedJob) {
      return null;
    }

    return this.buildProcessingJob(claimedJob);
  }

  startLeaseHeartbeat(jobId) {
    const intervalHandle = setInterval(() => {
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

  async resolveImageDescription({ imageUrl, model }) {
    const outcome = await this.descriptionJobService.resolveDescription({
      model,
      imageUrl,
    });

    if (outcome.kind === 'completed') {
      return outcome.result;
    }

    const waitForTerminalDescriptionJob = async (descriptionJob) => {
      if (!descriptionJob || !isPendingStatus(descriptionJob.status)) {
        return descriptionJob;
      }

      await this.sleep(this.pollIntervalMs);
      const refreshedJob = await this.descriptionJobService.getJobStatus(descriptionJob.id);
      return waitForTerminalDescriptionJob(refreshedJob);
    };

    const descriptionJob = await waitForTerminalDescriptionJob(outcome.job);

    if (descriptionJob?.status === 'succeeded' && descriptionJob.result) {
      return descriptionJob.result;
    }

    throw this.constructor.buildDescriptionJobError(descriptionJob);
  }

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
        clearInterval(heartbeat);
      }
    }
  }

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

  async waitForJob(jobId, waitTimeoutMs) {
    return this.pollJobUntilDeadline(jobId, Date.now() + waitTimeoutMs);
  }

  async pollJobUntilDeadline(jobId, deadline) {
    const job = await this.jobStore.get(jobId);

    if (!job || isTerminalStatus(job.status) || Date.now() >= deadline) {
      return job;
    }

    await this.ensureExecution(job);

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return this.jobStore.get(jobId);
    }

    await this.sleep(Math.min(this.pollIntervalMs, remainingMs));
    return this.pollJobUntilDeadline(jobId, deadline);
  }

  async resolvePageDescription({ model, pageUrl }) {
    const jobId = this.constructor.buildJobId({ model, pageUrl });
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
        throw this.constructor.buildJobError(pendingJob);
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
      throw this.constructor.buildJobError(maybeCompletedJob);
    }

    return {
      kind: 'pending',
      job: maybeCompletedJob ?? pendingJob,
    };
  }

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
