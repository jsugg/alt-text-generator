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

describe('ReplicateDescriberService.describeImage', () => {
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
    const mockReplicate = {
      run: jest.fn().mockRejectedValue(new Error('API error')),
    };
    const svc = new ReplicateDescriberService({
      logger: mockLogger,
      replicateClient: mockReplicate,
      config: mockConfig,
    });

    await expect(svc.describeImage('https://example.com/cat.jpg')).rejects.toThrow('API error');
  });
});
