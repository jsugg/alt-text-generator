const ImageDescriberFactory = require('../../../src/services/ImageDescriberFactory');
const { DescriptionJobService } = require('../../../src/services/DescriptionJobService');
const { createDeterministicScheduler } = require('../../helpers/deterministicScheduler');

const DEFAULT_NOW = Date.parse('2026-01-01T00:00:00.000Z');

const createJobStore = () => {
  const jobs = new Map();

  return {
    get: jest.fn(async (jobId) => jobs.get(jobId) ?? null),
    set: jest.fn(async (job) => {
      jobs.set(job.id, { ...job });
    }),
    delete: jest.fn(async (jobId) => {
      jobs.delete(jobId);
    }),
  };
};

const createService = ({
  describer,
  jobStore = createJobStore(),
  scheduler = createDeterministicScheduler({ initialNow: DEFAULT_NOW }),
  serviceOverrides = {},
}) => ({
  jobStore,
  scheduler,
  service: new DescriptionJobService({
    imageDescriberFactory: new ImageDescriberFactory().register('replicate', describer),
    jobStore,
    logger: {},
    waitTimeoutMs: 10,
    pollIntervalMs: 1,
    pendingTtlMs: 1000,
    completedTtlMs: 1000,
    failedTtlMs: 1000,
    now: scheduler.now,
    sleep: (durationMs) => scheduler.sleep(durationMs),
    ...serviceOverrides,
  }),
});

describe('Unit | Services | Description Job Service', () => {
  it('returns a cached completed result without creating a new provider job', async () => {
    const describer = {
      createDescriptionJob: jest.fn(),
      getDescriptionJob: jest.fn(),
    };
    const { jobStore, scheduler, service } = createService({ describer });
    const imageUrl = 'https://images.example.org/cat.jpg';
    const jobId = DescriptionJobService.buildJobId({
      model: 'replicate',
      imageUrl,
    });

    await jobStore.set({
      id: jobId,
      model: 'replicate',
      imageUrl,
      providerJobId: 'prediction-cached',
      status: 'succeeded',
      result: {
        description: 'cached caption',
        imageUrl,
      },
      createdAt: scheduler.isoString(),
      updatedAt: scheduler.isoString(),
      expiresAt: scheduler.isoString(1000),
    });

    const outcome = await service.resolveDescription({
      model: 'replicate',
      imageUrl,
    });

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        description: 'cached caption',
        imageUrl,
      },
    });
    expect(describer.createDescriptionJob).not.toHaveBeenCalled();
    expect(describer.getDescriptionJob).not.toHaveBeenCalled();
  });

  it('returns a completed result when an async provider finishes within the wait window', async () => {
    const scheduler = createDeterministicScheduler({ initialNow: DEFAULT_NOW });
    const describer = {
      createDescriptionJob: jest.fn().mockResolvedValue({
        providerJobId: 'prediction-1',
        imageUrl: 'https://example.com/cat.jpg',
        status: 'processing',
      }),
      getDescriptionJob: jest.fn(async () => (
        scheduler.now() >= DEFAULT_NOW + 2
          ? {
            providerJobId: 'prediction-1',
            imageUrl: 'https://example.com/cat.jpg',
            status: 'succeeded',
            result: {
              description: 'a cat sitting on a mat',
              imageUrl: 'https://example.com/cat.jpg',
            },
          }
          : {
            providerJobId: 'prediction-1',
            imageUrl: 'https://example.com/cat.jpg',
            status: 'processing',
          }
      )),
    };
    const { service } = createService({ describer, scheduler });

    const outcomePromise = service.resolveDescription({
      model: 'replicate',
      imageUrl: 'https://example.com/cat.jpg',
    });
    await scheduler.advanceBy(3);
    const outcome = await outcomePromise;

    expect(outcome.kind).toBe('completed');
    expect(outcome.result).toEqual({
      description: 'a cat sitting on a mat',
      imageUrl: 'https://example.com/cat.jpg',
    });
  });

  it('returns a pending job when the provider does not finish within the wait window', async () => {
    const scheduler = createDeterministicScheduler({ initialNow: DEFAULT_NOW });
    const describer = {
      createDescriptionJob: jest.fn().mockResolvedValue({
        providerJobId: 'prediction-2',
        imageUrl: 'https://example.com/cat.jpg',
        status: 'processing',
      }),
      getDescriptionJob: jest.fn().mockResolvedValue({
        providerJobId: 'prediction-2',
        imageUrl: 'https://example.com/cat.jpg',
        status: 'processing',
      }),
    };
    const { service } = createService({
      describer,
      scheduler,
      serviceOverrides: {
        waitTimeoutMs: 1,
      },
    });

    const outcomePromise = service.resolveDescription({
      model: 'replicate',
      imageUrl: 'https://example.com/cat.jpg',
    });
    await scheduler.advanceBy(1);
    const outcome = await outcomePromise;

    expect(outcome.kind).toBe('pending');
    expect(service.buildJobResponse(outcome.job)).toMatchObject({
      jobId: expect.any(String),
      model: 'replicate',
      imageUrl: 'https://example.com/cat.jpg',
      status: 'processing',
      pollAfterMs: 1,
      statusUrl: expect.stringContaining('/api/v1/accessibility/description-jobs/'),
    });
  });

  it('refreshes pending jobs when status is requested', async () => {
    const describer = {
      createDescriptionJob: jest.fn(),
      getDescriptionJob: jest.fn().mockResolvedValue({
        providerJobId: 'prediction-3',
        imageUrl: 'https://example.com/cat.jpg',
        status: 'succeeded',
        result: {
          description: 'completed later',
          imageUrl: 'https://example.com/cat.jpg',
        },
      }),
    };
    const { jobStore, scheduler, service } = createService({ describer });
    const jobId = DescriptionJobService.buildJobId({
      model: 'replicate',
      imageUrl: 'https://example.com/cat.jpg',
    });
    await jobStore.set({
      id: jobId,
      model: 'replicate',
      imageUrl: 'https://example.com/cat.jpg',
      providerJobId: 'prediction-3',
      status: 'processing',
      createdAt: scheduler.isoString(),
      updatedAt: scheduler.isoString(),
      expiresAt: scheduler.isoString(1000),
    });

    const job = await service.getJobStatus(jobId);

    expect(job.status).toBe('succeeded');
    expect(job.result).toEqual({
      description: 'completed later',
      imageUrl: 'https://example.com/cat.jpg',
    });
  });

  it('stores an immediately completed provider job as a completed job response', async () => {
    const imageUrl = 'https://images.example.org/completed.jpg';
    const describer = {
      createDescriptionJob: jest.fn().mockResolvedValue({
        providerJobId: 'prediction-complete',
        imageUrl,
        status: 'succeeded',
        result: {
          description: 'ready immediately',
          imageUrl,
        },
      }),
      getDescriptionJob: jest.fn(),
    };
    const { jobStore, service } = createService({ describer });

    const outcome = await service.resolveDescription({
      model: 'replicate',
      imageUrl,
    });

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: {
        description: 'ready immediately',
        imageUrl,
      },
    });
    expect(jobStore.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
      providerJobId: 'prediction-complete',
    }));
  });

  it('throws immediate provider job failures without persisting a pending job', async () => {
    const imageUrl = 'https://images.example.org/failed.jpg';
    const describer = {
      createDescriptionJob: jest.fn().mockResolvedValue({
        providerJobId: 'prediction-failed',
        imageUrl,
        status: 'failed',
        error: Object.assign(new Error('prediction failed'), { code: 'UPSTREAM_FAILURE' }),
      }),
      getDescriptionJob: jest.fn(),
    };
    const { jobStore, service } = createService({ describer });

    await expect(service.resolveDescription({
      model: 'replicate',
      imageUrl,
    })).rejects.toMatchObject({
      message: 'prediction failed',
      code: 'UPSTREAM_FAILURE',
    });

    expect(jobStore.set).not.toHaveBeenCalled();
  });

  it('returns null for unknown job ids and skips provider refresh for failed jobs', async () => {
    const describer = {
      createDescriptionJob: jest.fn(),
      getDescriptionJob: jest.fn(),
    };
    const { jobStore, scheduler, service } = createService({ describer });
    const failedJobId = DescriptionJobService.buildJobId({
      model: 'replicate',
      imageUrl: 'https://images.example.org/failure.jpg',
    });

    await jobStore.set({
      id: failedJobId,
      model: 'replicate',
      imageUrl: 'https://images.example.org/failure.jpg',
      providerJobId: 'prediction-failed',
      status: 'failed',
      error: { message: 'failed previously' },
      createdAt: scheduler.isoString(),
      updatedAt: scheduler.isoString(),
      expiresAt: scheduler.isoString(1000),
    });

    await expect(service.getJobStatus('missing-job-id')).resolves.toBeNull();
    await expect(service.getJobStatus(failedJobId)).resolves.toMatchObject({
      status: 'failed',
      error: { message: 'failed previously' },
    });
    expect(describer.getDescriptionJob).not.toHaveBeenCalled();
  });
});
