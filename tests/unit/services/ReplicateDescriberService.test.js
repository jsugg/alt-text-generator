const ReplicateDescriberService = require('../../../src/services/ReplicateDescriberService');
const { ProviderTimeoutError } = require('../../../src/errors/ProviderTimeoutError');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

const mockProviderConfig = {
  modelOwner: 'testowner',
  modelName: 'testmodel',
  modelVersion: 'abc123',
  requestTimeoutMs: 50,
  pollIntervalMs: 10,
};

describe('Unit | Services | Replicate Describer Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns description and imageUrl on success', async () => {
    const mockReplicate = {
      predictions: {
        create: jest.fn().mockResolvedValue({
          id: 'prediction-1',
          status: 'starting',
        }),
        get: jest.fn().mockResolvedValue({
          id: 'prediction-1',
          status: 'succeeded',
          output: 'a cat sitting on a mat',
        }),
      },
    };
    const svc = new ReplicateDescriberService({
      logger: mockLogger,
      replicateClient: mockReplicate,
      providerConfig: mockProviderConfig,
    });

    const result = await svc.describeImage('https://example.com/cat.jpg');

    expect(result).toEqual({
      description: 'a cat sitting on a mat',
      imageUrl: 'https://example.com/cat.jpg',
    });
    expect(mockReplicate.predictions.create).toHaveBeenCalledWith({
      version: 'abc123',
      input: { image: 'https://example.com/cat.jpg' },
    });
    expect(mockReplicate.predictions.get).toHaveBeenCalledWith('prediction-1');
  });

  it('propagates errors from the Replicate client', async () => {
    const error = new Error('API error');
    error.request = {
      method: 'POST',
      url: 'https://api.replicate.com/v1/predictions',
    };
    error.response = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        get: (name) => {
          const values = { 'retry-after': '30' };
          return values[name] ?? null;
        },
      },
    };
    const mockReplicate = {
      predictions: {
        create: jest.fn().mockRejectedValue(error),
      },
    };
    const svc = new ReplicateDescriberService({
      logger: mockLogger,
      replicateClient: mockReplicate,
      providerConfig: mockProviderConfig,
    });

    await expect(svc.describeImage('https://example.com/cat.jpg')).rejects.toThrow('API error');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({
      err: error,
      provider: 'replicate',
      imageUrl: 'https://example.com/cat.jpg',
      modelRef: 'testowner/testmodel:abc123',
      upstream: {
        request: {
          method: 'POST',
          url: 'https://api.replicate.com/v1/predictions',
        },
        response: {
          status: 429,
          statusText: 'Too Many Requests',
          headers: {
            'retry-after': '30',
          },
        },
      },
    }), 'Replicate prediction failed');
  });

  it('times out long-running predictions and requests cancellation', async () => {
    let now = 0;
    const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const mockReplicate = {
      predictions: {
        create: jest.fn().mockResolvedValue({
          id: 'prediction-2',
          status: 'starting',
        }),
        get: jest
          .fn()
          .mockResolvedValue({
            id: 'prediction-2',
            status: 'processing',
          }),
        cancel: jest.fn().mockResolvedValue(undefined),
      },
    };
    const svc = new ReplicateDescriberService({
      logger: mockLogger,
      replicateClient: mockReplicate,
      providerConfig: {
        ...mockProviderConfig,
        requestTimeoutMs: 20,
        pollIntervalMs: 10,
      },
      sleep: async (ms) => {
        now += ms;
      },
    });

    await expect(svc.describeImage('https://example.com/cat.jpg')).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
    expect(mockReplicate.predictions.cancel).toHaveBeenCalledWith('prediction-2');

    dateNowSpy.mockRestore();
  });

  it('creates asynchronous description jobs with provider metadata', async () => {
    const mockReplicate = {
      predictions: {
        create: jest.fn().mockResolvedValue({
          id: 'prediction-3',
          status: 'starting',
        }),
      },
    };
    const svc = new ReplicateDescriberService({
      logger: mockLogger,
      replicateClient: mockReplicate,
      providerConfig: mockProviderConfig,
    });

    const job = await svc.createDescriptionJob('https://example.com/cat.jpg');

    expect(job).toEqual({
      providerJobId: 'prediction-3',
      imageUrl: 'https://example.com/cat.jpg',
      status: 'starting',
    });
  });
});
