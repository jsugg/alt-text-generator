const { PageDescriptionJobService } = require('../../../src/services/PageDescriptionJobService');
const {
  createDeferred,
  createDeterministicScheduler,
} = require('../../helpers/deterministicScheduler');

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
  runnerId: 'runner-1',
});

const createScheduler = (initialNow = DEFAULT_NOW) => {
  const scheduler = createDeterministicScheduler({ initialNow });
  trackedSchedulers.push(scheduler);
  return scheduler;
};

const createJobStore = ({ now }) => {
  const jobs = new Map();

  return {
    get: jest.fn(async (jobId) => {
      const job = jobs.get(jobId);
      return job ? { ...job } : null;
    }),
    set: jest.fn(async (job) => {
      jobs.set(job.id, { ...job });
    }),
    claim: jest.fn(async (jobId, runnerId, leaseTtlMs) => {
      const job = jobs.get(jobId);

      if (!job) {
        return null;
      }

      const claimedJob = {
        ...job,
        runnerId,
        leaseExpiresAtEpochMs: now() + leaseTtlMs,
      };
      jobs.set(jobId, claimedJob);
      return { ...claimedJob };
    }),
  };
};

const registerCleanup = (callback) => {
  cleanupCallbacks.push(callback);
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
  jobStore = createJobStore({ now: scheduler.now }),
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

describe('Unit | Services | Page Description Job Service', () => {
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

  it('returns cached completed page jobs without launching new work', async () => {
    const pageDescriptionService = {
      describePageWithResolver: jest.fn(),
    };
    const {
      scheduler,
      jobStore,
      service,
    } = createService({
      pageDescriptionService,
      descriptionJobService: {
        resolveDescription: jest.fn(),
        getJobStatus: jest.fn(),
      },
    });
    const pageUrl = 'https://example.com/page';
    const jobId = PageDescriptionJobService.buildJobId({
      model: 'replicate',
      pageUrl,
    });

    await jobStore.set({
      id: jobId,
      jobType: 'page-description',
      model: 'replicate',
      pageUrl,
      status: 'succeeded',
      result: {
        pageUrl,
        model: 'replicate',
        totalImages: 1,
        uniqueImages: 1,
        descriptions: [],
      },
      createdAt: scheduler.isoString(),
      updatedAt: scheduler.isoString(),
      expiresAt: scheduler.isoString(1000),
    });

    const outcome = await service.resolvePageDescription({
      model: 'replicate',
      pageUrl,
    });

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        pageUrl,
        model: 'replicate',
      },
    });
    expect(pageDescriptionService.describePageWithResolver).not.toHaveBeenCalled();
  });

  it('returns a completed page result when the async page job finishes within the wait window', async () => {
    const scheduler = createScheduler();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn().mockImplementation(async ({ describeImage }) => {
        await scheduler.sleep(2);

        return {
          pageUrl: 'https://example.com/page',
          model: 'replicate',
          totalImages: 1,
          uniqueImages: 1,
          descriptions: [
            await describeImage('https://example.com/a.jpg'),
          ],
        };
      }),
    };
    const descriptionJobService = {
      resolveDescription: jest.fn().mockResolvedValue({
        kind: 'completed',
        result: {
          description: 'completed page description',
          imageUrl: 'https://example.com/a.jpg',
        },
      }),
      getJobStatus: jest.fn(),
    };
    const { service } = createService({
      scheduler,
      pageDescriptionService,
      descriptionJobService,
    });

    const outcomePromise = service.resolvePageDescription({
      model: 'replicate',
      pageUrl: 'https://example.com/page',
    });
    await scheduler.advanceBy(4);
    const outcome = await outcomePromise;

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        pageUrl: 'https://example.com/page',
        model: 'replicate',
        totalImages: 1,
        uniqueImages: 1,
      },
    });
    expect(descriptionJobService.resolveDescription).toHaveBeenCalledWith({
      model: 'replicate',
      imageUrl: 'https://example.com/a.jpg',
    });
    expect(scheduler.now() - DEFAULT_NOW).toBeLessThan(DEFAULT_SERVICE_OPTIONS.waitTimeoutMs);
    expect(service.activeJobs.size).toBe(0);
  });

  it('returns a pending page job when the background execution does not finish within the wait window', async () => {
    const scheduler = createScheduler();
    const pageWork = createDeferred();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn(() => pageWork.promise),
    };
    const {
      service,
    } = createService({
      scheduler,
      pageDescriptionService,
      descriptionJobService: {
        resolveDescription: jest.fn(),
        getJobStatus: jest.fn(),
      },
      serviceOverrides: {
        waitTimeoutMs: 1,
      },
    });
    registerCleanup(async () => {
      pageWork.resolve({
        pageUrl: 'https://example.com/page',
        model: 'replicate',
        totalImages: 0,
        uniqueImages: 0,
        descriptions: [],
      });
      await scheduler.drain();
    });

    const outcomePromise = service.resolvePageDescription({
      model: 'replicate',
      pageUrl: 'https://example.com/page',
    });
    await scheduler.advanceBy(1);
    const outcome = await outcomePromise;

    expect(outcome.kind).toBe('pending');
    expect(service.buildJobResponse(outcome.job)).toMatchObject({
      jobId: expect.any(String),
      model: 'replicate',
      pageUrl: 'https://example.com/page',
      status: expect.stringMatching(/pending|processing|starting/),
      statusUrl: expect.stringContaining('/api/v1/accessibility/page-description-jobs/'),
      pollAfterMs: 1,
    });
  });

  it('restarts pending page jobs on status lookup and returns terminal failures as stored jobs', async () => {
    const scheduler = createScheduler();
    const firstAttempt = createDeferred();
    const restartedAttempt = createDeferred();
    const pageDescriptionService = {
      describePageWithResolver: jest
        .fn()
        .mockImplementationOnce(() => firstAttempt.promise)
        .mockImplementationOnce(() => restartedAttempt.promise),
    };
    const {
      jobStore,
      service,
    } = createService({
      scheduler,
      pageDescriptionService,
      descriptionJobService: {
        resolveDescription: jest.fn(),
        getJobStatus: jest.fn(),
      },
      serviceOverrides: {
        waitTimeoutMs: 1,
      },
    });
    registerCleanup(async () => {
      restartedAttempt.resolve({
        pageUrl: 'https://example.com/page',
        model: 'replicate',
        totalImages: 0,
        uniqueImages: 0,
        descriptions: [],
      });
      await scheduler.drain();
    });

    const firstOutcomePromise = service.resolvePageDescription({
      model: 'replicate',
      pageUrl: 'https://example.com/page',
    });
    await scheduler.advanceBy(1);
    const firstOutcome = await firstOutcomePromise;
    expect(firstOutcome.kind).toBe('pending');

    firstAttempt.reject(Object.assign(new Error('page processing failed'), {
      code: 'UPSTREAM_FAILURE',
    }));
    await scheduler.drain();

    const failedJobId = PageDescriptionJobService.buildJobId({
      model: 'replicate',
      pageUrl: 'https://example.com/page',
    });
    await expect(service.getJobStatus(failedJobId)).resolves.toMatchObject({
      status: 'failed',
      error: {
        message: 'page processing failed',
        code: 'UPSTREAM_FAILURE',
      },
    });

    await jobStore.set({
      id: failedJobId,
      jobType: 'page-description',
      model: 'replicate',
      pageUrl: 'https://example.com/page',
      status: 'pending',
      createdAt: scheduler.isoString(),
      updatedAt: scheduler.isoString(),
      expiresAt: scheduler.isoString(1000),
    });

    const refreshedJob = await service.getJobStatus(failedJobId);

    expect(refreshedJob).toMatchObject({
      status: 'processing',
    });
    expect(pageDescriptionService.describePageWithResolver).toHaveBeenCalledTimes(2);
  });

  it('falls back to the store get method when no claim helper exists and returns null for missing jobs', async () => {
    const scheduler = createScheduler();
    const jobs = new Map();
    const jobStore = {
      get: jest.fn(async (jobId) => {
        const job = jobs.get(jobId);
        return job ? { ...job } : null;
      }),
      set: jest.fn(async (job) => {
        jobs.set(job.id, { ...job });
      }),
    };
    const { service } = createService({
      scheduler,
      pageDescriptionService: {
        describePageWithAsyncJobs: jest.fn(),
      },
      jobStore,
      descriptionJobService: undefined,
      serviceOverrides: {
        waitTimeoutMs: 1,
      },
    });

    await jobStore.set({
      id: 'page-job-no-claim',
      jobType: 'page-description',
      model: 'replicate',
      pageUrl: 'https://example.com/page',
      status: 'pending',
      createdAt: scheduler.isoString(),
      updatedAt: scheduler.isoString(),
      expiresAt: scheduler.isoString(1000),
    });

    await expect(service.refreshJobLease('page-job-no-claim')).resolves.toMatchObject({
      id: 'page-job-no-claim',
      status: 'processing',
      runnerId: 'runner-1',
    });
    await expect(service.getJobStatus('missing-page-job')).resolves.toBeNull();
  });

  it('reuses persisted description jobs while building the page result', async () => {
    const scheduler = createScheduler();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn().mockImplementation(async ({ describeImage }) => ({
        pageUrl: 'https://example.com/page',
        model: 'replicate',
        totalImages: 1,
        uniqueImages: 1,
        descriptions: [
          await describeImage('https://example.com/a.jpg'),
        ],
      })),
    };
    const childResult = {
      description: 'async description for https://example.com/a.jpg',
      imageUrl: 'https://example.com/a.jpg',
    };
    const descriptionJobService = {
      resolveDescription: jest.fn()
        .mockResolvedValueOnce({
          kind: 'pending',
          job: {
            id: 'description-job-1',
            status: 'processing',
          },
        }),
      getJobStatus: jest.fn()
        .mockResolvedValueOnce({
          id: 'description-job-1',
          status: 'processing',
        })
        .mockResolvedValueOnce({
          id: 'description-job-1',
          status: 'succeeded',
          result: {
            description: 'async description for https://example.com/a.jpg',
            imageUrl: 'https://example.com/a.jpg',
          },
        }),
    };
    descriptionJobService.getJobStatus.mockImplementation(async () => (
      scheduler.now() >= DEFAULT_NOW + 2
        ? {
            id: 'description-job-1',
            status: 'succeeded',
            result: childResult,
          }
        : {
            id: 'description-job-1',
            status: 'processing',
          }
    ));

    const { service } = createService({
      scheduler,
      pageDescriptionService,
      descriptionJobService,
    });

    const outcomePromise = service.resolvePageDescription({
      model: 'replicate',
      pageUrl: 'https://example.com/page',
    });
    await scheduler.advanceBy(3);
    const outcome = await outcomePromise;

    expect(outcome.kind).toBe('completed');
    expect(pageDescriptionService.describePageWithResolver).toHaveBeenCalledTimes(1);
    expect(descriptionJobService.resolveDescription).toHaveBeenCalledWith({
      model: 'replicate',
      imageUrl: 'https://example.com/a.jpg',
    });
    expect(descriptionJobService.getJobStatus).toHaveBeenCalledWith('description-job-1');
    expect(scheduler.now() - DEFAULT_NOW).toBeLessThan(DEFAULT_SERVICE_OPTIONS.waitTimeoutMs);
  });

  it('fails the page job when a dependent description job fails or disappears', async () => {
    const scheduler = createScheduler();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn().mockImplementation(async ({ describeImage }) => ({
        pageUrl: 'https://example.com/page',
        model: 'replicate',
        totalImages: 1,
        uniqueImages: 1,
        descriptions: [
          await describeImage('https://example.com/a.jpg'),
        ],
      })),
    };
    const { service } = createService({
      scheduler,
      pageDescriptionService,
      descriptionJobService: {
        resolveDescription: jest.fn().mockResolvedValue({
          kind: 'pending',
          job: {
            id: 'description-job-2',
            status: 'processing',
          },
        }),
        getJobStatus: jest.fn()
          .mockResolvedValueOnce({
            id: 'description-job-2',
            status: 'failed',
            error: {
              message: 'upstream child job failed',
              code: 'DESCRIPTION_PROVIDER_TIMEOUT',
            },
          })
          .mockResolvedValueOnce(null),
      },
      jobStore: createJobStore({ now: scheduler.now }),
    });

    const failedDescriptionPromise = service.resolveImageDescription({
      model: 'replicate',
      imageUrl: 'https://example.com/a.jpg',
    });
    await scheduler.advanceBy(1);
    await expect(failedDescriptionPromise).rejects.toMatchObject({
      message: 'upstream child job failed',
      code: 'DESCRIPTION_PROVIDER_TIMEOUT',
    });

    const missingDescriptionPromise = service.resolveImageDescription({
      model: 'replicate',
      imageUrl: 'https://example.com/a.jpg',
    });
    await scheduler.advanceBy(1);
    await expect(missingDescriptionPromise).rejects.toThrow('Description job failed');
  });

  it('cleans up failed page jobs when execution settles before the wait deadline', async () => {
    const scheduler = createScheduler();
    const pageWork = createDeferred();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn(() => pageWork.promise),
    };
    const {
      jobStore,
      service,
    } = createService({
      scheduler,
      pageDescriptionService,
      descriptionJobService: {
        resolveDescription: jest.fn(),
        getJobStatus: jest.fn(),
      },
    });

    const outcomePromise = service.resolvePageDescription({
      model: 'replicate',
      pageUrl: 'https://example.com/page',
    });

    pageWork.reject(Object.assign(new Error('page processing failed'), {
      code: 'UPSTREAM_FAILURE',
    }));
    await scheduler.advanceBy(1);

    await expect(outcomePromise).rejects.toMatchObject({
      message: 'page processing failed',
      code: 'UPSTREAM_FAILURE',
    });

    const failedJobId = PageDescriptionJobService.buildJobId({
      model: 'replicate',
      pageUrl: 'https://example.com/page',
    });
    await expect(jobStore.get(failedJobId)).resolves.toMatchObject({
      status: 'failed',
      error: {
        message: 'page processing failed',
        code: 'UPSTREAM_FAILURE',
      },
    });
    expect(service.activeJobs.size).toBe(0);
  });

  it('builds page-job errors and skips execution when the job is terminal, active, or unclaimable', async () => {
    const { service } = createService({
      pageDescriptionService: {
        describePageWithResolver: jest.fn(),
      },
      descriptionJobService: {
        resolveDescription: jest.fn(),
        getJobStatus: jest.fn(),
      },
      jobStore: {
        get: jest.fn(),
        set: jest.fn(),
        claim: jest.fn().mockResolvedValue(null),
      },
    });

    expect(PageDescriptionJobService.buildJobError({
      error: { message: 'failed without code' },
    })).toMatchObject({
      message: 'failed without code',
    });
    expect(PageDescriptionJobService.buildJobError({
      error: { message: 'failed with code', code: 'PAGE_FAILED' },
    })).toMatchObject({
      message: 'failed with code',
      code: 'PAGE_FAILED',
    });
    expect(PageDescriptionJobService.buildDescriptionJobError({
      error: { message: 'description failed', code: 'DESCRIPTION_FAILED' },
    })).toMatchObject({
      message: 'description failed',
      code: 'DESCRIPTION_FAILED',
    });

    await expect(service.ensureExecution({
      id: 'terminal-job',
      status: 'succeeded',
    })).resolves.toBe(false);

    service.activeJobs.set('active-job', Promise.resolve());
    await expect(service.ensureExecution({
      id: 'active-job',
      status: 'processing',
    })).resolves.toBe(false);
    service.activeJobs.delete('active-job');

    await expect(service.ensureExecution({
      id: 'unclaimable-job',
      status: 'pending',
    })).resolves.toBe(false);
  });
});
