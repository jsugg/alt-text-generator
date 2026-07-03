const { createClient, WatchError } = require('redis');

const {
  DESCRIPTION_JOB_STORE_MODES,
} = require('../../config/descriptionJobStore');

const DEFAULT_CLAIM_RETRY_COUNT = 3;

/**
 * @typedef {object} StoredJob
 * @property {string} id
 * @property {string} [expiresAt]
 * @property {number} [leaseExpiresAtEpochMs]
 * @property {string} [leaseExpiresAt]
 * @property {string} [runnerId]
 */

/**
 * @typedef {object} RedisTransaction
 * @property {(key: string, value: string, options?: object) => unknown} set
 * @property {() => Promise<unknown>} exec
 */

/**
 * @typedef {object} RedisClient
 * @property {() => RedisTransaction} multi
 * @property {(key: string) => Promise<unknown>} watch
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, value: string, options?: object) => Promise<unknown>} set
 * @property {(key: string) => Promise<unknown>} del
 * @property {() => Promise<unknown>} [unwatch]
 * @property {boolean} isOpen
 * @property {() => Promise<unknown>} quit
 */

/**
 * @typedef {object} DescriptionJobsConfig
 * @property {string} [kind]
 * @property {string} [redisUrl]
 * @property {string} [redisPrefix]
 */

/**
 * @param {StoredJob | null | undefined} job
 * @returns {boolean}
 */
const isExpired = (job) => (
  typeof job?.expiresAt === 'string'
  && Date.parse(job.expiresAt) <= Date.now()
);

/**
 * @param {StoredJob | null | undefined} job
 * @returns {boolean}
 */
const isLeaseActive = (job) => (
  Number.isFinite(job?.leaseExpiresAtEpochMs)
  && /** @type {number} */ (job?.leaseExpiresAtEpochMs) > Date.now()
);

/**
 * @param {StoredJob} job
 * @param {string} runnerId
 * @param {number} leaseTtlMs
 * @returns {StoredJob}
 */
const buildClaimedJob = (job, runnerId, leaseTtlMs) => {
  const leaseExpiresAtEpochMs = Date.now() + leaseTtlMs;

  return {
    ...job,
    runnerId,
    leaseExpiresAtEpochMs,
    leaseExpiresAt: new Date(leaseExpiresAtEpochMs).toISOString(),
  };
};

/**
 * @param {StoredJob} job
 * @param {string} runnerId
 * @returns {boolean}
 */
const canClaimJob = (job, runnerId) => (
  Boolean(job)
  && (!job.runnerId || job.runnerId === runnerId || !isLeaseActive(job))
);

/**
 * @param {StoredJob} job
 * @returns {number}
 */
const getTtlSeconds = (job) => Math.max(
  Math.ceil((Date.parse(/** @type {string} */ (job.expiresAt)) - Date.now()) / 1000),
  1,
);

class InMemoryDescriptionJobStore {
  constructor() {
    this.jobs = /** @type {Map<string, StoredJob>} */ (new Map());
  }

  /**
   * @param {string} jobId
   * @returns {Promise<StoredJob | null>}
   */
  async get(jobId) {
    const job = this.jobs.get(jobId);

    if (!job) {
      return null;
    }

    if (isExpired(job)) {
      this.jobs.delete(jobId);
      return null;
    }

    return { ...job };
  }

  /**
   * @param {StoredJob} job
   * @returns {Promise<void>}
   */
  async set(job) {
    this.jobs.set(job.id, { ...job });
  }

  /**
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async delete(jobId) {
    this.jobs.delete(jobId);
  }

  /**
   * @param {string} jobId
   * @param {string} runnerId
   * @param {number} leaseTtlMs
   * @returns {Promise<StoredJob | null>}
   */
  async claim(jobId, runnerId, leaseTtlMs) {
    const job = this.jobs.get(jobId);

    if (!job || isExpired(job) || !canClaimJob(job, runnerId)) {
      return null;
    }

    const claimedJob = buildClaimedJob(job, runnerId, leaseTtlMs);
    this.jobs.set(jobId, claimedJob);
    return { ...claimedJob };
  }

  async close() {
    this.jobs.clear();
  }
}

/**
 * @param {{ client: RedisClient, prefix: string }} params
 */
const createRedisDescriptionJobStore = ({ client, prefix }) => {
  /** @param {string} jobId @returns {string} */
  const buildKey = (jobId) => `${prefix}${jobId}`;
  /** @param {string} payload @returns {StoredJob} */
  const parsePayload = (payload) => JSON.parse(payload);
  /**
   * @param {string} key
   * @param {StoredJob} job
   * @returns {Promise<unknown>}
   */
  const persistWatchedJob = async (key, job) => {
    const transaction = client.multi();
    transaction.set(key, JSON.stringify(job), {
      EX: getTtlSeconds(job),
    });

    try {
      return await transaction.exec();
    } catch (error) {
      // node-redis rejects with WatchError when a watched key changed between
      // WATCH and EXEC. That is the optimistic-lock "lost the race" signal, so
      // surface it as a falsy result and let attemptClaim retry (and ultimately
      // refuse the claim) instead of throwing out of the claim path.
      if (error instanceof WatchError) {
        return null;
      }

      throw error;
    }
  };
  /**
   * @param {{ attemptNumber: number, jobId: string, runnerId: string, leaseTtlMs: number }} params
   * @returns {Promise<StoredJob | null>}
   */
  const attemptClaim = async ({
    attemptNumber,
    jobId,
    runnerId,
    leaseTtlMs,
  }) => {
    const key = buildKey(jobId);
    await client.watch(key);
    const payload = await client.get(key);

    if (!payload) {
      await client.unwatch?.();
      return null;
    }

    const job = parsePayload(payload);
    if (isExpired(job)) {
      await client.unwatch?.();
      await client.del(key);
      return null;
    }

    if (!canClaimJob(job, runnerId)) {
      await client.unwatch?.();
      return null;
    }

    const claimedJob = buildClaimedJob(job, runnerId, leaseTtlMs);
    const result = await persistWatchedJob(key, claimedJob);
    if (result) {
      return claimedJob;
    }

    if (attemptNumber >= DEFAULT_CLAIM_RETRY_COUNT) {
      return null;
    }

    return attemptClaim({
      attemptNumber: attemptNumber + 1,
      jobId,
      runnerId,
      leaseTtlMs,
    });
  };

  return {
    /**
     * @param {string} jobId
     * @returns {Promise<StoredJob | null>}
     */
    async get(jobId) {
      const payload = await client.get(buildKey(jobId));
      if (!payload) {
        return null;
      }

      const job = parsePayload(payload);
      if (isExpired(job)) {
        await this.delete(jobId);
        return null;
      }

      return job;
    },
    /**
     * @param {StoredJob} job
     * @returns {Promise<void>}
     */
    async set(job) {
      await client.set(buildKey(job.id), JSON.stringify(job), {
        EX: getTtlSeconds(job),
      });
    },
    /**
     * @param {string} jobId
     * @returns {Promise<void>}
     */
    async delete(jobId) {
      await client.del(buildKey(jobId));
    },
    /**
     * @param {string} jobId
     * @param {string} runnerId
     * @param {number} leaseTtlMs
     * @returns {Promise<StoredJob | null>}
     */
    async claim(jobId, runnerId, leaseTtlMs) {
      return attemptClaim({
        attemptNumber: 1,
        jobId,
        runnerId,
        leaseTtlMs,
      });
    },
    async close() {
      if (!client.isOpen) {
        return;
      }

      await client.quit();
    },
  };
};

const createMemoryDescriptionJobStore = () => new InMemoryDescriptionJobStore();

/**
 * @param {{ config?: { descriptionJobs?: DescriptionJobsConfig }, logger?: { error?: (...args: unknown[]) => void }, createClientFn?: typeof createClient }} [options]
 * @returns {Promise<unknown>}
 */
const initializeDescriptionJobStore = async ({
  config,
  logger,
  createClientFn = createClient,
} = {}) => {
  const descriptionJobsConfig = config?.descriptionJobs ?? /** @type {DescriptionJobsConfig} */ ({});

  if (descriptionJobsConfig.kind !== DESCRIPTION_JOB_STORE_MODES.REDIS) {
    return createMemoryDescriptionJobStore();
  }

  if (!descriptionJobsConfig.redisUrl) {
    throw new Error(
      'Description job store is configured for Redis but no Redis URL was provided',
    );
  }

  const redisClient = createClientFn({
    url: descriptionJobsConfig.redisUrl,
  });
  redisClient.on?.('error', (error) => {
    logger?.error?.({ err: error }, 'Description-job Redis client error');
  });
  await redisClient.connect();

  return createRedisDescriptionJobStore({
    client: /** @type {RedisClient} */ (/** @type {unknown} */ (redisClient)),
    prefix: /** @type {string} */ (descriptionJobsConfig.redisPrefix),
  });
};

module.exports = {
  createMemoryDescriptionJobStore,
  createRedisDescriptionJobStore,
  initializeDescriptionJobStore,
  InMemoryDescriptionJobStore,
};
