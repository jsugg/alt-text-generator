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
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('fake-image-bytes'),
        headers: {
          'content-type': 'image/png',
        },
      }),
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
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('image-bytes'),
        headers: {
          'content-type': 'image/jpeg',
        },
      }),
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

    expect(mockHttpClient.get).toHaveBeenCalledWith('https://example.com/img.jpg', {
      timeout: undefined,
      maxRedirects: undefined,
      maxContentLength: undefined,
      maxBodyLength: undefined,
      responseType: 'arraybuffer',
    });
    const [url, data, axiosConfig] = mockHttpClient.post.mock.calls[0];
    expect(url).toBe(
      'https://eastus.api.cognitive.microsoft.com/vision/v3.2/describe?maxCandidates=4&language=en&model-version=latest&overload=stream',
    );
    expect(Buffer.isBuffer(data)).toBe(true);
    expect(data.equals(Buffer.from('image-bytes'))).toBe(true);
    expect(axiosConfig.headers['Ocp-Apim-Subscription-Key']).toBe('test-key');
    expect(axiosConfig.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('propagates errors from the HTTP client', async () => {
    const error = new Error('Azure error');
    error.code = 'ENOTFOUND';
    error.config = {
      method: 'get',
      url: 'https://example.com/img.jpg',
    };
    const mockHttpClient = {
      get: jest.fn().mockRejectedValue(error),
      post: jest.fn().mockRejectedValue(error),
    };
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: mockHttpClient,
      config: mockConfig,
    });

    await expect(svc.describeImage('https://example.com/img.jpg')).rejects.toThrow('Azure error');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({
      err: error,
      provider: 'azure',
      endpoint: mockConfig.azure.apiEndpoint,
      imageUrl: 'https://example.com/img.jpg',
      upstream: {
        code: 'ENOTFOUND',
        request: {
          method: 'GET',
          url: 'https://example.com/img.jpg',
        },
      },
    }), 'Azure description request failed');
  });

  it('throws a descriptive error when Azure returns no captions', async () => {
    const mockHttpClient = {
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('image-bytes'),
        headers: {
          'content-type': 'image/png',
        },
      }),
      post: jest.fn().mockResolvedValue({
        data: {
          description: {
            captions: [],
          },
        },
      }),
    };
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: mockHttpClient,
      config: mockConfig,
    });

    await expect(svc.describeImage('https://example.com/img.jpg'))
      .rejects
      .toThrow('Azure provider returned no captions');
  });

  it('filters unsupported sources before they reach Azure', () => {
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: {
        get: jest.fn(),
        post: jest.fn(),
      },
      config: mockConfig,
    });

    expect(svc.filterSupportedImageSources([
      'https://example.com/a.svg',
      'https://example.com/b.png',
      'https://example.com/c.jpg',
    ])).toEqual([
      'https://example.com/b.png',
      'https://example.com/c.jpg',
    ]);
  });

  it('rejects unsupported image content types before calling Azure', async () => {
    const mockHttpClient = {
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('<svg></svg>'),
        headers: {
          'content-type': 'image/svg+xml',
        },
      }),
      post: jest.fn(),
    };
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: mockHttpClient,
      config: mockConfig,
    });

    await expect(svc.describeImage('https://example.com/a.svg'))
      .rejects
      .toThrow("Azure provider does not support content type 'image/svg+xml'");
    expect(mockHttpClient.post).not.toHaveBeenCalled();
  });

  it('marks image-source download failures as skippable for page descriptions', () => {
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: {
        get: jest.fn(),
        post: jest.fn(),
      },
      config: mockConfig,
    });
    const error = new Error('not found');
    error.response = { status: 404 };
    error.config = {
      url: 'https://example.com/missing.png',
    };

    expect(svc.shouldSkipDescriptionError(error)).toBe(true);
  });

  it('does not mark Azure auth failures as skippable', () => {
    const svc = new AzureDescriberService({
      logger: mockLogger,
      httpClient: {
        get: jest.fn(),
        post: jest.fn(),
      },
      config: mockConfig,
    });
    const error = new Error('permission denied');
    error.response = {
      status: 401,
      data: {
        error: {
          code: 'PermissionDenied',
        },
      },
    };
    error.config = {
      url: 'https://eastus.api.cognitive.microsoft.com/vision/v3.2/describe?maxCandidates=4',
    };

    expect(svc.shouldSkipDescriptionError(error)).toBe(false);
  });
});
