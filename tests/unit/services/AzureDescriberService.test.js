const AzureDescriberService = require('../../../src/services/AzureDescriberService');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const mockConfig = {
  azure: {
    apiEndpoint: 'https://eastus.api.cognitive.microsoft.com/vision/v3.2/describe',
    subscriptionKey: 'test-key',
    language: 'en',
    maxCandidates: 4,
  },
};

describe('AzureDescriberService.describeImage', () => {
  it('returns joined captions as description', async () => {
    const mockHttpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          description: {
            captions: [
              { text: 'a dog in the park', confidence: 0.9 },
              { text: 'a dog playing', confidence: 0.8 },
            ],
          },
        },
      }),
    };
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: mockHttpClient,
      config: mockConfig,
    });

    const result = await svc.describeImage('https://example.com/dog.jpg');

    expect(result).toEqual({
      description: 'a dog in the park, a dog playing',
      imageUrl: 'https://example.com/dog.jpg',
    });
  });

  it('calls the API with correct url, data, and headers', async () => {
    const mockHttpClient = {
      post: jest.fn().mockResolvedValue({
        data: { description: { captions: [{ text: 'test' }] } },
      }),
    };
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: mockHttpClient,
      config: mockConfig,
    });

    await svc.describeImage('https://example.com/img.jpg');

    const [url, data, axiosConfig] = mockHttpClient.post.mock.calls[0];
    expect(url).toContain('maxCandidates=4');
    expect(url).toContain('language=en');
    expect(data).toEqual({ url: 'https://example.com/img.jpg' });
    expect(axiosConfig.headers['Ocp-Apim-Subscription-Key']).toBe('test-key');
  });

  it('propagates errors from the HTTP client', async () => {
    const mockHttpClient = {
      post: jest.fn().mockRejectedValue(new Error('Azure error')),
    };
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: mockHttpClient,
      config: mockConfig,
    });

    await expect(svc.describeImage('https://example.com/img.jpg')).rejects.toThrow('Azure error');
  });
});
