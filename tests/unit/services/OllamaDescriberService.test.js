const OllamaDescriberService = require('../../../src/services/OllamaDescriberService');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const mockProviderConfig = {
  baseUrl: 'http://127.0.0.1:11434',
  model: 'llama3.2-vision',
  prompt: 'Describe this image.',
  keepAlive: '5m',
};

describe('Unit | Services | Ollama Describer Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('downloads the image and submits it to the Ollama chat api', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('image-bytes'),
        headers: {
          'content-type': 'image/jpeg',
        },
      }),
      post: jest.fn().mockResolvedValue({
        data: {
          message: {
            content: 'a surfer riding a wave',
          },
        },
      }),
    };
    const svc = new OllamaDescriberService({
      logger: mockLogger,
      httpClient,
      providerConfig: mockProviderConfig,
      requestOptions: {
        timeout: 700,
        maxRedirects: 3,
        maxContentLength: 4096,
      },
    });

    const result = await svc.describeImage('https://example.com/surfer.jpg');

    expect(result).toEqual({
      description: 'a surfer riding a wave',
      imageUrl: 'https://example.com/surfer.jpg',
    });
    expect(httpClient.get).toHaveBeenCalledWith('https://example.com/surfer.jpg', {
      timeout: 700,
      maxRedirects: 3,
      maxContentLength: 4096,
      maxBodyLength: 4096,
      responseType: 'arraybuffer',
    });
    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        model: 'llama3.2-vision',
        keep_alive: '5m',
        messages: [
          {
            role: 'user',
            content: 'Describe this image.',
            images: [Buffer.from('image-bytes').toString('base64')],
          },
        ],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 700,
      },
    );
  });

  it('marks image-source download failures as skippable', () => {
    const svc = new OllamaDescriberService({
      logger: mockLogger,
      httpClient: {
        get: jest.fn(),
        post: jest.fn(),
      },
      providerConfig: mockProviderConfig,
    });
    const error = new Error('missing image');
    error.response = { status: 404 };
    error.config = {
      url: 'https://example.com/missing.png',
    };

    expect(svc.shouldSkipDescriptionError(error)).toBe(true);
  });
});
