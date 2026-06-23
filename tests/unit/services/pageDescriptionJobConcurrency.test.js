const { PageDescriptionJobService } = require('../../../src/services/PageDescriptionJobService');
const {
  createDeferred,
  createDeterministicScheduler,
} = require('../../helpers/deterministicScheduler');

// QE-016 / ATG-QE-03A: deterministic concurrency proofs for the page-description
// job orchestrator. These exercise the concurrency-sensitive seams (active-job
// map, lease claiming, heartbeat refresh) without real timers, so a duplicate
// submission, a competing runner, a flaky lease refresh, or a settled job all
// produce a single, observable outcome instead of a race.

const trackedSchedulers = [];
const trackedServices = [];
const cleanupCallbacks = [];

const DEFAULT_NOW = Date.parse('2026-01-01T00:00:00.000Z');
const DEFAULT_SERVICE_OPTIONS = Object.freeze({
  logger: {},
  waitTimeoutMs: 10,
  pollIntervalMs: 1,
  pendingTtlMs: 1000,
  completedTtlMs: 1000,
  failedTtlMs: 1000,
  claimTtlMs: 1000,
});
// claimTtlMs / 2 with the defaults above; the heartbeat fires every 500ms.
const LEASE_REFRESH_INTERVAL_MS = 500;
const MODEL = 'replicate';
const PAGE_URL = 'https://example.com/page';

const emptyPageResult = (pageUrl = PAGE_URL) => ({
  pageUrl,
  model: MODEL,
  totalImages: 0,
  uniqueImages: 0,
  descriptions: [],
});

const createScheduler = (initialNow = DEFAULT_NOW) => {
  const scheduler = createDeterministicScheduler({ initialNow });
  trackedSchedulers.push(scheduler);
  return scheduler;
};

// In-memory job store double with real lease/ownership semantics driven by the
// injected deterministic clock, plus a claim interceptor so a test can make the
// Redis-equivalent claim throw or refuse on a chosen call.
const createSharedJobStore = ({ now }) => {
  const jobs = new Map();
  let claimInterceptor = null;
  let claimCallCount = 0;

  const isLeaseActive = (job) => (
    Number.isFinite(job?.leaseExpiresAtEpochMs)
    && job.leaseExpiresAtEpochMs > now()
  );
  const canClaim = (job, runnerId) => (
    Boolean(job)
    && (!job.runnerId || job.runnerId === runnerId || !isLeaseActive(job))
  );

  return {
    jobs,
    setClaimInterceptor: (interceptor) => {
      claimInterceptor = interceptor;
    },
    claimCallCount: () => claimCallCount,
    get: jest.fn(async (jobId) => {
      const job = jobs.get(jobId);
      return job ? { ...job } : null;
    }),
    set: jest.fn(async (job) => {
      jobs.set(job.id, { ...job });
    }),
    delete: jest.fn(async (jobId) => {
      jobs.delete(jobId);
    }),
    claim: jest.fn(async (jobId, runnerId, leaseTtlMs) => {
      claimCallCount += 1;
      const defaultClaim = async () => {
        const job = jobs.get(jobId);
        if (!canClaim(job, runnerId)) {
          return null;
        }

        const leaseExpiresAtEpochMs = now() + leaseTtlMs;
        const claimedJob = {
          ...job,
          runnerId,
          leaseExpiresAtEpochMs,
          leaseExpiresAt: new Date(leaseExpiresAtEpochMs).toISOString(),
        };
        jobs.set(jobId, claimedJob);
        return { ...claimedJob };
      };

      if (claimInterceptor) {
        return claimInterceptor({
          callCount: claimCallCount,
          args: { jobId, runnerId, leaseTtlMs },
          defaultClaim,
        });
      }

      return defaultClaim();
    }),
  };
};

const runRegisteredCleanups = async () => cleanupCallbacks
  .splice(0)
  .reverse()
  .reduce(
    (promise, cleanup) => promise.then(() => cleanup()),
    Promise.resolve(),
  );

const createService = ({
  scheduler = createScheduler(),
  pageDescriptionService,
  descriptionJobService = {
    resolveDescription: jest.fn(),
    getJobStatus: jest.fn(),
  },
  jobStore = createSharedJobStore({ now: scheduler.now }),
  serviceOverrides = {},
} = {}) => {
  const service = new PageDescriptionJobService({
    ...DEFAULT_SERVICE_OPTIONS,
    pageDescriptionService,
    descriptionJobService,
    jobStore,
    now: scheduler.now,
    sleep: (durationMs) => scheduler.sleep(durationMs),
    setInterval: (callback, intervalMs) => scheduler.setInterval(callback, intervalMs),
    clearInterval: (handle) => scheduler.clearInterval(handle),
    ...serviceOverrides,
  });

  trackedServices.push(service);
  return {
    scheduler,
    jobStore,
    service,
    pageDescriptionService,
    descriptionJobService,
  };
};

const seedPendingPageJob = async (jobStore, scheduler, { pageUrl = PAGE_URL } = {}) => {
  const jobId = PageDescriptionJobService.buildJobId({ model: MODEL, pageUrl });

  await jobStore.set({
    id: jobId,
    jobType: 'page-description',
    model: MODEL,
    pageUrl,
    status: 'pending',
    createdAt: scheduler.isoString(),
    updatedAt: scheduler.isoString(),
    expiresAt: scheduler.isoString(1000),
  });

  return jobId;
};

describe('Unit | Services | Page Description Job Concurrency', () => {
  afterEach(async () => {
    await runRegisteredCleanups();

    await Promise.all(trackedSchedulers.map(async (scheduler) => {
      await scheduler.drain();
      expect(scheduler.pendingIntervalCount()).toBe(0);
    }));

    trackedServices.forEach((service) => {
      expect(service.activeJobs.size).toBe(0);
    });

    trackedSchedulers.length = 0;
    trackedServices.length = 0;
  });

  it('reuses a single in-flight job and runs the page work once for duplicate submissions', async () => {
    const scheduler = createScheduler();
    const pageWork = createDeferred();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn(() => pageWork.promise),
    };
    const { service, jobStore } = createService({
      scheduler,
      pageDescriptionService,
      serviceOverrides: { waitTimeoutMs: 1 },
    });

    const firstSubmission = service.resolvePageDescription({ model: MODEL, pageUrl: PAGE_URL });
    await scheduler.advanceBy(1);
    const firstOutcome = await firstSubmission;

    expect(firstOutcome.kind).toBe('pending');
    expect(service.activeJobs.size).toBe(1);

    // Second request arrives while the first is still executing in the background.
    const secondSubmission = service.resolvePageDescription({ model: MODEL, pageUrl: PAGE_URL });
    await scheduler.advanceBy(1);
    const secondOutcome = await secondSubmission;

    const jobId = PageDescriptionJobService.buildJobId({ model: MODEL, pageUrl: PAGE_URL });
    expect(secondOutcome.kind).toBe('pending');
    expect(firstOutcome.job.id).toBe(jobId);
    expect(secondOutcome.job.id).toBe(jobId);
    expect(pageDescriptionService.describePageWithResolver).toHaveBeenCalledTimes(1);
    expect(service.activeJobs.size).toBe(1);

    pageWork.resolve(emptyPageResult());
    await scheduler.drain();

    expect(service.activeJobs.size).toBe(0);
    expect(jobStore.jobs.size).toBe(1);
    await expect(service.getJobStatus(jobId)).resolves.toMatchObject({ status: 'succeeded' });
    expect(pageDescriptionService.describePageWithResolver).toHaveBeenCalledTimes(1);
  });

  it('lets one runner claim a shared job and blocks the competing runner', async () => {
    const scheduler = createScheduler();
    const jobStore = createSharedJobStore({ now: scheduler.now });
    const winnerWork = createDeferred();
    const winnerPageService = {
      describePageWithResolver: jest.fn(() => winnerWork.promise),
    };
    const loserPageService = {
      describePageWithResolver: jest.fn(),
    };
    const { service: winner } = createService({
      scheduler,
      pageDescriptionService: winnerPageService,
      jobStore,
      serviceOverrides: { runnerId: 'runner-a' },
    });
    const { service: loser } = createService({
      scheduler,
      pageDescriptionService: loserPageService,
      jobStore,
      serviceOverrides: { runnerId: 'runner-b' },
    });

    const jobId = await seedPendingPageJob(jobStore, scheduler);

    const winnerClaimed = await winner.ensureExecution(await jobStore.get(jobId));
    const loserClaimed = await loser.ensureExecution(await jobStore.get(jobId));

    expect(winnerClaimed).toBe(true);
    expect(loserClaimed).toBe(false);
    expect(winnerPageService.describePageWithResolver).toHaveBeenCalledTimes(1);
    expect(loserPageService.describePageWithResolver).not.toHaveBeenCalled();
    expect(winner.activeJobs.size).toBe(1);
    expect(loser.activeJobs.size).toBe(0);

    const claimedJob = await jobStore.get(jobId);
    expect(claimedJob.runnerId).toBe('runner-a');

    winnerWork.resolve(emptyPageResult());
    await scheduler.drain();

    expect(winner.activeJobs.size).toBe(0);
    const settledJob = await jobStore.get(jobId);
    expect(settledJob.status).toBe('succeeded');
    expect(settledJob.runnerId).toBeUndefined();
  });

  it('keeps the heartbeat alive when a lease refresh fails and recovers it on the next tick', async () => {
    const scheduler = createScheduler();
    const jobStore = createSharedJobStore({ now: scheduler.now });
    const pageWork = createDeferred();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const pageDescriptionService = {
      describePageWithResolver: jest.fn(() => pageWork.promise),
    };
    const { service } = createService({
      scheduler,
      pageDescriptionService,
      jobStore,
      serviceOverrides: { logger, runnerId: 'runner-a' },
    });

    const jobId = await seedPendingPageJob(jobStore, scheduler);

    // Claim #1 is the ownership claim (must succeed); claim #2 is the first
    // heartbeat refresh, which we force to throw like a transient Redis blip.
    jobStore.setClaimInterceptor(({ callCount, defaultClaim }) => {
      if (callCount === 2) {
        throw new Error('redis claim failed during lease refresh');
      }

      return defaultClaim();
    });

    await service.ensureExecution(await jobStore.get(jobId));

    // First heartbeat: the refresh throws but the interval keeps running.
    await scheduler.advanceBy(LEASE_REFRESH_INTERVAL_MS);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, runnerId: 'runner-a' }),
      'Failed to refresh page-description job lease',
    );
    const afterFailure = await jobStore.get(jobId);

    // Second heartbeat: the refresh succeeds and pushes the lease deadline out.
    await scheduler.advanceBy(LEASE_REFRESH_INTERVAL_MS);
    const afterRecovery = await jobStore.get(jobId);

    expect(afterRecovery.status).toBe('processing');
    expect(afterRecovery.leaseExpiresAtEpochMs)
      .toBeGreaterThan(afterFailure.leaseExpiresAtEpochMs);

    pageWork.resolve(emptyPageResult());
    await scheduler.drain();

    expect(service.activeJobs.size).toBe(0);
    await expect(jobStore.get(jobId)).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('drains the active-job map after concurrent jobs settle to success and failure', async () => {
    const scheduler = createScheduler();
    const jobStore = createSharedJobStore({ now: scheduler.now });
    const succeedingUrl = 'https://example.com/ok';
    const failingUrl = 'https://example.com/boom';
    const succeedingWork = createDeferred();
    const failingWork = createDeferred();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn(({ pageUrl }) => (
        pageUrl === succeedingUrl ? succeedingWork.promise : failingWork.promise
      )),
    };
    const { service } = createService({
      scheduler,
      pageDescriptionService,
      jobStore,
    });

    const succeedingJobId = await seedPendingPageJob(jobStore, scheduler, { pageUrl: succeedingUrl });
    const failingJobId = await seedPendingPageJob(jobStore, scheduler, { pageUrl: failingUrl });

    await Promise.all([
      service.ensureExecution(await jobStore.get(succeedingJobId)),
      service.ensureExecution(await jobStore.get(failingJobId)),
    ]);
    expect(service.activeJobs.size).toBe(2);

    succeedingWork.resolve(emptyPageResult(succeedingUrl));
    failingWork.reject(Object.assign(new Error('page processing failed'), {
      code: 'UPSTREAM_FAILURE',
    }));
    await scheduler.drain();

    expect(service.activeJobs.size).toBe(0);
    await expect(jobStore.get(succeedingJobId)).resolves.toMatchObject({ status: 'succeeded' });
    await expect(jobStore.get(failingJobId)).resolves.toMatchObject({
      status: 'failed',
      error: { message: 'page processing failed', code: 'UPSTREAM_FAILURE' },
    });
  });
});
