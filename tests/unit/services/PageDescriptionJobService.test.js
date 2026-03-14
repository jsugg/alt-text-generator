const { PageDescriptionJobService } = require('../../../src/services/PageDescriptionJobService');

const createJobStore = () => {
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
        leaseExpiresAtEpochMs: Date.now() + leaseTtlMs,
      };
      jobs.set(jobId, claimedJob);
      return { ...claimedJob };
    }),
  };
};

describe('Unit | Services | Page Description Job Service', () => {
  it('returns cached completed page jobs without launching new work', async () => {
    const jobStore = createJobStore();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn(),
    };
    const descriptionJobService = {
      resolveDescription: jest.fn(),
      getJobStatus: jest.fn(),
    };
    const service = new PageDescriptionJobService({
      pageDescriptionService,
      descriptionJobService,
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      claimTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
      runnerId: 'runner-1',
    });
    const pageUrl = 'https://example.com/page';
    const jobId = PageDescriptionJobService.buildJobId({
      model: 'clip',
      pageUrl,
    });

    await jobStore.set({
      id: jobId,
      jobType: 'page-description',
      model: 'clip',
      pageUrl,
      status: 'succeeded',
      result: {
        pageUrl,
        model: 'clip',
        totalImages: 1,
        uniqueImages: 1,
        descriptions: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });

    const outcome = await service.resolvePageDescription({
      model: 'clip',
      pageUrl,
    });

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        pageUrl,
        model: 'clip',
      },
    });
    expect(pageDescriptionService.describePageWithResolver).not.toHaveBeenCalled();
  });

  it('returns a completed page result when the async page job finishes within the wait window', async () => {
    const jobStore = createJobStore();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn().mockImplementation(async ({ describeImage }) => ({
        pageUrl: 'https://example.com/page',
        model: 'clip',
        totalImages: 1,
        uniqueImages: 1,
        descriptions: [
          await describeImage('https://example.com/a.jpg'),
        ],
      })),
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
    const service = new PageDescriptionJobService({
      pageDescriptionService,
      descriptionJobService,
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      claimTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
      runnerId: 'runner-1',
    });

    const outcome = await service.resolvePageDescription({
      model: 'clip',
      pageUrl: 'https://example.com/page',
    });

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        pageUrl: 'https://example.com/page',
        model: 'clip',
        totalImages: 1,
        uniqueImages: 1,
      },
    });
    expect(descriptionJobService.resolveDescription).toHaveBeenCalledWith({
      model: 'clip',
      imageUrl: 'https://example.com/a.jpg',
    });
  });

  it('returns a pending page job when the background execution does not finish within the wait window', async () => {
    let now = 0;
    const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const jobStore = createJobStore();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn(() => new Promise(() => {})),
    };
    const descriptionJobService = {
      resolveDescription: jest.fn(),
      getJobStatus: jest.fn(),
    };
    const service = new PageDescriptionJobService({
      pageDescriptionService,
      descriptionJobService,
      jobStore,
      logger: {},
      waitTimeoutMs: 1,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      claimTtlMs: 1000,
      sleep: jest.fn(async (ms) => {
        now += ms;
      }),
      runnerId: 'runner-1',
    });

    const outcome = await service.resolvePageDescription({
      model: 'clip',
      pageUrl: 'https://example.com/page',
    });

    expect(outcome.kind).toBe('pending');
    expect(service.buildJobResponse(outcome.job)).toMatchObject({
      jobId: expect.any(String),
      model: 'clip',
      pageUrl: 'https://example.com/page',
      status: expect.stringMatching(/pending|processing/),
      statusUrl: expect.stringContaining('/api/v1/accessibility/page-description-jobs/'),
      pollAfterMs: 1,
    });
    dateNowSpy.mockRestore();
  });

  it('restarts pending page jobs on status lookup and returns terminal failures as stored jobs', async () => {
    let now = 0;
    const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const jobStore = createJobStore();
    const pageDescriptionService = {
      describePageWithResolver: jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('page processing failed'), {
          code: 'UPSTREAM_FAILURE',
        }))
        .mockImplementationOnce(() => new Promise(() => {})),
    };
    const descriptionJobService = {
      resolveDescription: jest.fn(),
      getJobStatus: jest.fn(),
    };
    const service = new PageDescriptionJobService({
      pageDescriptionService,
      descriptionJobService,
      jobStore,
      logger: {},
      waitTimeoutMs: 1,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      claimTtlMs: 1000,
      sleep: jest.fn(async (ms) => {
        now += ms;
      }),
      runnerId: 'runner-1',
    });

    const firstOutcome = await service.resolvePageDescription({
      model: 'clip',
      pageUrl: 'https://example.com/page',
    });
    expect(firstOutcome.kind).toBe('pending');

    const failedJobId = PageDescriptionJobService.buildJobId({
      model: 'clip',
      pageUrl: 'https://example.com/page',
    });
    await service.activeJobs.get(failedJobId);
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
      model: 'clip',
      pageUrl: 'https://example.com/page',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });

    const refreshedJob = await service.getJobStatus(failedJobId);

    expect(refreshedJob).toMatchObject({
      status: 'processing',
    });
    expect(pageDescriptionService.describePageWithResolver).toHaveBeenCalledTimes(2);
    dateNowSpy.mockRestore();
  });

  it('falls back to the store get method when no claim helper exists and returns null for missing jobs', async () => {
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
    const service = new PageDescriptionJobService({
      pageDescriptionService: {
        describePageWithAsyncJobs: jest.fn(() => new Promise(() => {})),
      },
      jobStore,
      logger: {},
      waitTimeoutMs: 1,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      claimTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
      runnerId: 'runner-1',
    });

    await jobStore.set({
      id: 'page-job-no-claim',
      jobType: 'page-description',
      model: 'clip',
      pageUrl: 'https://example.com/page',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });

    await expect(service.refreshJobLease('page-job-no-claim')).resolves.toMatchObject({
      id: 'page-job-no-claim',
      status: 'processing',
      runnerId: 'runner-1',
    });
    await expect(service.getJobStatus('missing-page-job')).resolves.toBeNull();
  });

  it('reuses persisted description jobs while building the page result', async () => {
    const jobStore = createJobStore();
    const pageDescriptionService = {
      describePageWithResolver: jest.fn().mockImplementation(async ({ describeImage }) => ({
        pageUrl: 'https://example.com/page',
        model: 'clip',
        totalImages: 1,
        uniqueImages: 1,
        descriptions: [
          await describeImage('https://example.com/a.jpg'),
        ],
      })),
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
    const service = new PageDescriptionJobService({
      pageDescriptionService,
      descriptionJobService,
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      claimTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
      runnerId: 'runner-1',
    });

    const outcome = await service.resolvePageDescription({
      model: 'clip',
      pageUrl: 'https://example.com/page',
    });

    expect(outcome.kind).toBe('completed');
    expect(pageDescriptionService.describePageWithResolver).toHaveBeenCalledTimes(1);
    expect(descriptionJobService.resolveDescription).toHaveBeenCalledWith({
      model: 'clip',
      imageUrl: 'https://example.com/a.jpg',
    });
    expect(descriptionJobService.getJobStatus).toHaveBeenCalledWith('description-job-1');
  });

  it('fails the page job when a dependent description job fails or disappears', async () => {
    const pageDescriptionService = {
      describePageWithResolver: jest.fn().mockImplementation(async ({ describeImage }) => ({
        pageUrl: 'https://example.com/page',
        model: 'clip',
        totalImages: 1,
        uniqueImages: 1,
        descriptions: [
          await describeImage('https://example.com/a.jpg'),
        ],
      })),
    };
    const service = new PageDescriptionJobService({
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
      jobStore: createJobStore(),
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      claimTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
      runnerId: 'runner-1',
    });

    await expect(service.resolveImageDescription({
      model: 'clip',
      imageUrl: 'https://example.com/a.jpg',
    })).rejects.toMatchObject({
      message: 'upstream child job failed',
      code: 'DESCRIPTION_PROVIDER_TIMEOUT',
    });

    await expect(service.resolveImageDescription({
      model: 'clip',
      imageUrl: 'https://example.com/a.jpg',
    })).rejects.toThrow('Description job failed');
  });

  it('builds page-job errors and skips execution when the job is terminal, active, or unclaimable', async () => {
    const service = new PageDescriptionJobService({
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
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      claimTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
      runnerId: 'runner-1',
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

    await expect(service.ensureExecution({
      id: 'unclaimable-job',
      status: 'pending',
    })).resolves.toBe(false);
  });
});
