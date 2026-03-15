const ImageDescriberFactory = require('../../../src/services/ImageDescriberFactory');
const { DescriptionJobService } = require('../../../src/services/DescriptionJobService');

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

describe('Unit | Services | Description Job Service', () => {
  it('returns a cached completed result without creating a new provider job', async () => {
    const jobStore = createJobStore();
    const describer = {
      createDescriptionJob: jest.fn(),
      getDescriptionJob: jest.fn(),
    };
    const service = new DescriptionJobService({
      imageDescriberFactory: new ImageDescriberFactory().register('replicate', describer),
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
    });
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
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
    const jobStore = createJobStore();
    const describer = {
      createDescriptionJob: jest.fn().mockResolvedValue({
        providerJobId: 'prediction-1',
        imageUrl: 'https://example.com/cat.jpg',
        status: 'processing',
      }),
      getDescriptionJob: jest.fn().mockResolvedValue({
        providerJobId: 'prediction-1',
        imageUrl: 'https://example.com/cat.jpg',
        status: 'succeeded',
        result: {
          description: 'a cat sitting on a mat',
          imageUrl: 'https://example.com/cat.jpg',
        },
      }),
    };
    const service = new DescriptionJobService({
      imageDescriberFactory: new ImageDescriberFactory().register('replicate', describer),
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
    });

    const outcome = await service.resolveDescription({
      model: 'replicate',
      imageUrl: 'https://example.com/cat.jpg',
    });

    expect(outcome.kind).toBe('completed');
    expect(outcome.result).toEqual({
      description: 'a cat sitting on a mat',
      imageUrl: 'https://example.com/cat.jpg',
    });
  });

  it('returns a pending job when the provider does not finish within the wait window', async () => {
    const jobStore = createJobStore();
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
    const service = new DescriptionJobService({
      imageDescriberFactory: new ImageDescriberFactory().register('replicate', describer),
      jobStore,
      logger: {},
      waitTimeoutMs: 0,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
    });

    const outcome = await service.resolveDescription({
      model: 'replicate',
      imageUrl: 'https://example.com/cat.jpg',
    });

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
    const jobStore = createJobStore();
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
    const factory = new ImageDescriberFactory().register('replicate', describer);
    const service = new DescriptionJobService({
      imageDescriberFactory: factory,
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
    });
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });

    const job = await service.getJobStatus(jobId);

    expect(job.status).toBe('succeeded');
    expect(job.result).toEqual({
      description: 'completed later',
      imageUrl: 'https://example.com/cat.jpg',
    });
  });

  it('stores an immediately completed provider job as a completed job response', async () => {
    const jobStore = createJobStore();
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
    const service = new DescriptionJobService({
      imageDescriberFactory: new ImageDescriberFactory().register('replicate', describer),
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
    });

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
    const jobStore = createJobStore();
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
    const service = new DescriptionJobService({
      imageDescriberFactory: new ImageDescriberFactory().register('replicate', describer),
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
    });

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
    const jobStore = createJobStore();
    const describer = {
      createDescriptionJob: jest.fn(),
      getDescriptionJob: jest.fn(),
    };
    const service = new DescriptionJobService({
      imageDescriberFactory: new ImageDescriberFactory().register('replicate', describer),
      jobStore,
      logger: {},
      waitTimeoutMs: 10,
      pollIntervalMs: 1,
      pendingTtlMs: 1000,
      completedTtlMs: 1000,
      failedTtlMs: 1000,
      sleep: jest.fn().mockResolvedValue(undefined),
    });
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });

    await expect(service.getJobStatus('missing-job-id')).resolves.toBeNull();
    await expect(service.getJobStatus(failedJobId)).resolves.toMatchObject({
      status: 'failed',
      error: { message: 'failed previously' },
    });
    expect(describer.getDescriptionJob).not.toHaveBeenCalled();
  });
});
