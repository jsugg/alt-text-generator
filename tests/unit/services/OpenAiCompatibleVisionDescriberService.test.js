const OpenAiCompatibleVisionDescriberService = require('../../../src/services/OpenAiCompatibleVisionDescriberService');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const mockProviderConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://api.example.com/v1',
  model: 'vision-model',
  maxTokens: 160,
  prompt: 'Describe this image.',
  headers: {
    'X-Test': 'true',
  },
};

describe('Unit | Services | OpenAI Compatible Vision Describer Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends a chat completion request with the remote image url', async () => {
    const apiClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: 'a lighthouse on the coast',
              },
            },
          ],
        },
      }),
    };
    const svc = new OpenAiCompatibleVisionDescriberService({
      logger: mockLogger,
      httpClient: {
        get: jest.fn(),
      },
      apiClient,
      providerConfig: mockProviderConfig,
      providerKey: 'openai',
      providerName: 'OpenAI Vision',
      requestOptions: {
        timeout: 1500,
      },
    });

    const result = await svc.describeImage('https://example.com/lighthouse.jpg');

    expect(result).toEqual({
      description: 'a lighthouse on the coast',
      imageUrl: 'https://example.com/lighthouse.jpg',
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        model: 'vision-model',
        max_tokens: 160,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image.' },
              {
                type: 'image_url',
                image_url: {
                  url: 'https://example.com/lighthouse.jpg',
                },
              },
            ],
          },
        ],
      }),
      {
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          'X-Test': 'true',
        },
        timeout: 1500,
      },
    );
  });

  it('falls back to a fetched data url when the provider rejects the remote image url', async () => {
    const remoteUrlError = new Error('invalid image url');
    remoteUrlError.response = { status: 400 };
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('image-bytes'),
        headers: {
          'content-type': 'image/png',
        },
      }),
    };
    const apiClient = {
      post: jest.fn()
        .mockRejectedValueOnce(remoteUrlError)
        .mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: [{ type: 'text', text: 'a fallback caption' }],
                },
              },
            ],
          },
        }),
    };
    const svc = new OpenAiCompatibleVisionDescriberService({
      logger: mockLogger,
      httpClient,
      apiClient,
      providerConfig: mockProviderConfig,
      providerKey: 'openai',
      providerName: 'OpenAI Vision',
      requestOptions: {
        timeout: 900,
        maxRedirects: 2,
        maxContentLength: 2048,
      },
    });

    const result = await svc.describeImage('https://example.com/fallback.png');

    expect(result).toEqual({
      description: 'a fallback caption',
      imageUrl: 'https://example.com/fallback.png',
    });
    expect(httpClient.get).toHaveBeenCalledWith('https://example.com/fallback.png', {
      timeout: 900,
      maxRedirects: 2,
      maxContentLength: 2048,
      maxBodyLength: 2048,
      responseType: 'arraybuffer',
    });
    expect(apiClient.post.mock.calls[1][1].messages[0].content[1].image_url.url)
      .toMatch(/^data:image\/png;base64,/);
  });

  it('marks image download failures as skippable after a fallback fetch', () => {
    const svc = new OpenAiCompatibleVisionDescriberService({
      logger: mockLogger,
      httpClient: {
        get: jest.fn(),
      },
      apiClient: {
        post: jest.fn(),
      },
      providerConfig: mockProviderConfig,
      providerKey: 'openai',
      providerName: 'OpenAI Vision',
    });
    const error = new Error('missing image');
    error.response = { status: 404 };
    error.config = {
      url: 'https://example.com/missing.png',
    };

    expect(svc.shouldSkipDescriptionError(error)).toBe(true);
  });
});
