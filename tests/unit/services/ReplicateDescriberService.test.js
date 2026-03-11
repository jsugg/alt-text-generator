const ReplicateDescriberService = require('../../../src/services/ReplicateDescriberService');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const mockConfig = {
  replicate: {
    modelOwner: 'testowner',
    modelName: 'testmodel',
    modelVersion: 'abc123',
  },
};

describe('Unit | Services | Replicate Describer Service', () => {
  it('returns description and imageUrl on success', async () => {
    const mockReplicate = {
      run: jest.fn().mockResolvedValue('a cat sitting on a mat'),
    };
    const svc = new ReplicateDescriberService({
      logger: mockLogger,
      replicateClient: mockReplicate,
      config: mockConfig,
    });

    const result = await svc.describeImage('https://example.com/cat.jpg');

    expect(result).toEqual({
      description: 'a cat sitting on a mat',
      imageUrl: 'https://example.com/cat.jpg',
    });
    expect(mockReplicate.run).toHaveBeenCalledWith(
      'testowner/testmodel:abc123',
      { input: { image: 'https://example.com/cat.jpg' } },
    );
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
      run: jest.fn().mockRejectedValue(error),
    };
    const svc = new ReplicateDescriberService({
      logger: mockLogger,
      replicateClient: mockReplicate,
      config: mockConfig,
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
});
