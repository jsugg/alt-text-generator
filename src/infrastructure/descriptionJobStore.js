const { createClient } = require('redis');

const {
  DESCRIPTION_JOB_STORE_MODES,
} = require('../../config/descriptionJobStore');

const DEFAULT_CLAIM_RETRY_COUNT = 3;

const isExpired = (job) => (
  typeof job?.expiresAt === 'string'
  && Date.parse(job.expiresAt) <= Date.now()
);

const isLeaseActive = (job) => (
  Number.isFinite(job?.leaseExpiresAtEpochMs)
  && job.leaseExpiresAtEpochMs > Date.now()
);

const buildClaimedJob = (job, runnerId, leaseTtlMs) => {
  const leaseExpiresAtEpochMs = Date.now() + leaseTtlMs;

  return {
    ...job,
    runnerId,
    leaseExpiresAtEpochMs,
    leaseExpiresAt: new Date(leaseExpiresAtEpochMs).toISOString(),
  };
};

const canClaimJob = (job, runnerId) => (
  Boolean(job)
  && (!job.runnerId || job.runnerId === runnerId || !isLeaseActive(job))
);

const getTtlSeconds = (job) => Math.max(
  Math.ceil((Date.parse(job.expiresAt) - Date.now()) / 1000),
  1,
);

class InMemoryDescriptionJobStore {
  constructor() {
    this.jobs = new Map();
  }

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

  async set(job) {
    this.jobs.set(job.id, { ...job });
  }

  async delete(jobId) {
    this.jobs.delete(jobId);
  }

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

const createRedisDescriptionJobStore = ({ client, prefix }) => {
  const buildKey = (jobId) => `${prefix}${jobId}`;
  const parsePayload = (payload) => JSON.parse(payload);
  const persistWatchedJob = async (key, job) => {
    const transaction = client.multi();
    transaction.set(key, JSON.stringify(job), {
      EX: getTtlSeconds(job),
    });

    return transaction.exec();
  };
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
    async set(job) {
      await client.set(buildKey(job.id), JSON.stringify(job), {
        EX: getTtlSeconds(job),
      });
    },
    async delete(jobId) {
      await client.del(buildKey(jobId));
    },
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

const initializeDescriptionJobStore = async ({
  config,
  logger,
  createClientFn = createClient,
} = {}) => {
  const descriptionJobsConfig = config?.descriptionJobs ?? {};

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
    client: redisClient,
    prefix: descriptionJobsConfig.redisPrefix,
  });
};

module.exports = {
  createMemoryDescriptionJobStore,
  createRedisDescriptionJobStore,
  initializeDescriptionJobStore,
  InMemoryDescriptionJobStore,
};
