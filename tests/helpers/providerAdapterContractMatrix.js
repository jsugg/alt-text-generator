const { ProviderTimeoutError } = require('../../src/errors/ProviderTimeoutError');

const IMAGE_URL = 'https://example.com/assets/provider-contract.png';
const IMAGE_BYTES = Buffer.from('provider-contract-image');
const REQUEST_TIMEOUT_MS = 1234;

const REQUIRED_PROVIDER_CONTRACT_CASES = Object.freeze([
  {
    name: 'normalizes successful image descriptions',
    methodName: 'assertSuccessfulNormalization',
  },
  {
    name: 'classifies isolated image-source failures as skippable',
    methodName: 'assertSkippableImageSourceFailure',
  },
  {
    name: 'propagates non-skippable provider failures',
    methodName: 'assertNonSkippableProviderFailureMapping',
  },
  {
    name: 'applies outbound timeout handling',
    methodName: 'assertTimeoutHandling',
  },
  {
    name: 'propagates prompt, model, and limit configuration',
    methodName: 'assertPromptModelAndLimitPropagation',
  },
]);

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
});

const createOutboundUrlPolicy = () => jest.fn().mockResolvedValue(undefined);

const createImageAssetResponse = (contentType = 'image/png') => ({
  data: IMAGE_BYTES,
  headers: {
    'content-type': contentType,
  },
});

const createImageSourceError = () => {
  const error = new Error('image source not found');
  error.response = { status: 404 };
  error.config = {
    method: 'get',
    url: IMAGE_URL,
  };

  return error;
};

const createProviderError = (message, url, status = 401) => {
  const error = new Error(message);
  error.response = {
    status,
    statusText: status === 401 ? 'Unauthorized' : 'Provider Error',
  };
  error.config = {
    method: 'post',
    url,
  };

  return error;
};

const getRequestBody = (client) => client.post.mock.calls[0][1];

const getRequestOptions = (client) => client.post.mock.calls[0][2];

const expectProviderRegistered = (provider, providerContracts) => {
  const contract = providerContracts[provider.key];

  if (!contract) {
    throw new Error(`Provider '${provider.key}' is missing from providerAdapterContracts`);
  }

  return contract;
};

const assertProviderContractComplete = (provider, contract, methodName) => {
  if (typeof contract[methodName] !== 'function') {
    throw new Error(`Provider '${provider.key}' contract is missing ${methodName}()`);
  }
};

const assertEveryProviderIsRegistered = ({ providerDefinitions, providerContracts }) => {
  expect(Object.keys(providerContracts)).toEqual(providerDefinitions.map((provider) => provider.key));
};

const runProviderAdapterContractMatrix = ({ providerDefinitions, providerContracts }) => {
  describe.each(providerDefinitions.map((provider) => [
    provider.key,
    provider,
  ]))('%s provider adapter contract', (_providerKey, provider) => {
    it.each(REQUIRED_PROVIDER_CONTRACT_CASES)('$name', async ({ methodName }) => {
      const contract = expectProviderRegistered(provider, providerContracts);
      assertProviderContractComplete(provider, contract, methodName);

      await contract[methodName]({ provider });
    });
  });
};

const createOpenAiCompatibleRuntime = (provider) => {
  const logger = createLogger();
  const httpClient = {
    get: jest.fn(),
  };
  const apiClient = {
    post: jest.fn(),
  };
  const providerConfig = {
    apiKey: `${provider.key}-api-key`,
    baseUrl: `https://${provider.key}.provider-contract.example/v1`,
    model: `${provider.key}-vision-model`,
    maxTokens: 321,
    prompt: `Describe this image for ${provider.key}.`,
    headers: {
      'X-Provider-Contract': provider.key,
    },
  };
  const runtime = provider.createRuntime({
    config: {
      [provider.configKey]: providerConfig,
    },
    logger,
    httpClient,
    outboundUrlPolicy: createOutboundUrlPolicy(),
    requestOptions: {
      timeout: REQUEST_TIMEOUT_MS,
    },
    providerClient: apiClient,
  });

  return {
    apiClient,
    httpClient,
    logger,
    providerConfig,
    runtime,
  };
};

const createOpenAiCompatibleContract = () => ({
  async assertSuccessfulNormalization({ provider }) {
    const { apiClient, runtime } = createOpenAiCompatibleRuntime(provider);
    apiClient.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: `${provider.key} normalized caption`,
            },
          },
        ],
      },
    });

    await expect(runtime.describeImage(IMAGE_URL)).resolves.toEqual({
      description: `${provider.key} normalized caption`,
      imageUrl: IMAGE_URL,
    });
  },

  async assertSkippableImageSourceFailure({ provider }) {
    const { runtime } = createOpenAiCompatibleRuntime(provider);

    expect(runtime.shouldSkipDescriptionError(createImageSourceError())).toBe(true);
  },

  async assertNonSkippableProviderFailureMapping({ provider }) {
    const { apiClient, logger, providerConfig, runtime } = createOpenAiCompatibleRuntime(provider);
    const error = createProviderError(`${provider.displayName} provider denied request`, runtime.buildChatUrl());
    apiClient.post.mockRejectedValue(error);

    await expect(runtime.describeImage(IMAGE_URL)).rejects.toThrow(error.message);
    expect(runtime.shouldSkipDescriptionError(error)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      err: error,
      endpoint: providerConfig.baseUrl,
      imageUrl: IMAGE_URL,
      provider: provider.key,
    }), `${provider.displayName} description request failed`);
  },

  async assertTimeoutHandling({ provider }) {
    const { apiClient, runtime } = createOpenAiCompatibleRuntime(provider);
    apiClient.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: 'timeout propagation caption',
            },
          },
        ],
      },
    });

    await runtime.describeImage(IMAGE_URL);

    expect(getRequestOptions(apiClient).timeout).toBe(REQUEST_TIMEOUT_MS);
  },

  async assertPromptModelAndLimitPropagation({ provider }) {
    const { apiClient, providerConfig, runtime } = createOpenAiCompatibleRuntime(provider);
    apiClient.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: 'configuration propagation caption',
            },
          },
        ],
      },
    });

    await runtime.describeImage(IMAGE_URL);

    const requestBody = getRequestBody(apiClient);
    const requestOptions = getRequestOptions(apiClient);

    expect(requestBody).toMatchObject({
      model: providerConfig.model,
      max_tokens: providerConfig.maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: providerConfig.prompt },
            {
              type: 'image_url',
              image_url: {
                url: IMAGE_URL,
              },
            },
          ],
        },
      ],
    });
    expect(requestOptions.headers).toMatchObject({
      Authorization: `Bearer ${providerConfig.apiKey}`,
      'Content-Type': 'application/json',
      'X-Provider-Contract': provider.key,
    });
  },
});

const createAzureRuntime = (provider) => {
  const logger = createLogger();
  const httpClient = {
    get: jest.fn(),
    post: jest.fn(),
  };
  const providerConfig = {
    apiEndpoint: 'https://azure.provider-contract.example/vision/v3.2/describe',
    subscriptionKey: 'azure-contract-key',
    language: 'pt-BR',
    maxCandidates: 7,
  };
  const runtime = provider.createRuntime({
    config: {
      [provider.configKey]: providerConfig,
    },
    logger,
    httpClient,
    outboundUrlPolicy: createOutboundUrlPolicy(),
    requestOptions: {
      maxContentLength: 4096,
      timeout: REQUEST_TIMEOUT_MS,
    },
  });

  return {
    httpClient,
    logger,
    providerConfig,
    runtime,
  };
};

const azureContract = {
  async assertSuccessfulNormalization({ provider }) {
    const { httpClient, runtime } = createAzureRuntime(provider);
    httpClient.get.mockResolvedValue(createImageAssetResponse('image/jpeg'));
    httpClient.post.mockResolvedValue({
      data: {
        description: {
          captions: [
            { text: 'azure first caption' },
            { text: 'azure second caption' },
          ],
        },
      },
    });

    await expect(runtime.describeImage(IMAGE_URL)).resolves.toEqual({
      description: 'azure first caption, azure second caption',
      imageUrl: IMAGE_URL,
    });
  },

  async assertSkippableImageSourceFailure({ provider }) {
    const { runtime } = createAzureRuntime(provider);

    expect(runtime.shouldSkipDescriptionError(createImageSourceError())).toBe(true);
  },

  async assertNonSkippableProviderFailureMapping({ provider }) {
    const { httpClient, logger, providerConfig, runtime } = createAzureRuntime(provider);
    const error = createProviderError('Azure provider denied request', runtime.buildDescribeUrl(true));
    httpClient.get.mockResolvedValue(createImageAssetResponse());
    httpClient.post.mockRejectedValue(error);

    await expect(runtime.describeImage(IMAGE_URL)).rejects.toThrow(error.message);
    expect(runtime.shouldSkipDescriptionError(error)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      err: error,
      endpoint: providerConfig.apiEndpoint,
      imageUrl: IMAGE_URL,
      provider: provider.key,
    }), 'Azure description request failed');
  },

  async assertTimeoutHandling({ provider }) {
    const { httpClient, runtime } = createAzureRuntime(provider);
    httpClient.get.mockResolvedValue(createImageAssetResponse());
    httpClient.post.mockResolvedValue({
      data: {
        description: {
          captions: [{ text: 'azure timeout caption' }],
        },
      },
    });

    await runtime.describeImage(IMAGE_URL);

    expect(httpClient.get.mock.calls[0][1].timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(getRequestOptions(httpClient).timeout).toBe(REQUEST_TIMEOUT_MS);
  },

  async assertPromptModelAndLimitPropagation({ provider }) {
    const { httpClient, providerConfig, runtime } = createAzureRuntime(provider);
    httpClient.get.mockResolvedValue(createImageAssetResponse());
    httpClient.post.mockResolvedValue({
      data: {
        description: {
          captions: [{ text: 'azure config caption' }],
        },
      },
    });

    await runtime.describeImage(IMAGE_URL);

    const [requestUrl, _requestBody, requestOptions] = httpClient.post.mock.calls[0];
    const parsedUrl = new URL(requestUrl);

    expect(parsedUrl.searchParams.get('language')).toBe(providerConfig.language);
    expect(parsedUrl.searchParams.get('maxCandidates')).toBe(String(providerConfig.maxCandidates));
    expect(requestOptions.headers['Ocp-Apim-Subscription-Key']).toBe(providerConfig.subscriptionKey);
  },
};

const createOllamaRuntime = (provider) => {
  const logger = createLogger();
  const httpClient = {
    get: jest.fn(),
  };
  const apiClient = {
    post: jest.fn(),
  };
  const providerConfig = {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.2-vision-contract',
    prompt: 'Describe this image through Ollama.',
    keepAlive: '5m',
  };
  const runtime = provider.createRuntime({
    config: {
      [provider.configKey]: providerConfig,
    },
    logger,
    httpClient,
    outboundUrlPolicy: createOutboundUrlPolicy(),
    requestOptions: {
      maxContentLength: 4096,
      timeout: REQUEST_TIMEOUT_MS,
    },
    providerClient: apiClient,
  });

  return {
    apiClient,
    httpClient,
    logger,
    providerConfig,
    runtime,
  };
};

const ollamaContract = {
  async assertSuccessfulNormalization({ provider }) {
    const { apiClient, httpClient, runtime } = createOllamaRuntime(provider);
    httpClient.get.mockResolvedValue(createImageAssetResponse('image/jpeg'));
    apiClient.post.mockResolvedValue({
      data: {
        message: {
          content: 'ollama normalized caption',
        },
      },
    });

    await expect(runtime.describeImage(IMAGE_URL)).resolves.toEqual({
      description: 'ollama normalized caption',
      imageUrl: IMAGE_URL,
    });
  },

  async assertSkippableImageSourceFailure({ provider }) {
    const { runtime } = createOllamaRuntime(provider);

    expect(runtime.shouldSkipDescriptionError(createImageSourceError())).toBe(true);
  },

  async assertNonSkippableProviderFailureMapping({ provider }) {
    const { apiClient, httpClient, logger, providerConfig, runtime } = createOllamaRuntime(provider);
    const error = createProviderError('Ollama provider denied request', runtime.buildChatUrl());
    httpClient.get.mockResolvedValue(createImageAssetResponse());
    apiClient.post.mockRejectedValue(error);

    await expect(runtime.describeImage(IMAGE_URL)).rejects.toThrow(error.message);
    expect(runtime.shouldSkipDescriptionError(error)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      err: error,
      endpoint: providerConfig.baseUrl,
      imageUrl: IMAGE_URL,
      provider: provider.key,
    }), 'Ollama description request failed');
  },

  async assertTimeoutHandling({ provider }) {
    const { apiClient, httpClient, runtime } = createOllamaRuntime(provider);
    httpClient.get.mockResolvedValue(createImageAssetResponse());
    apiClient.post.mockResolvedValue({
      data: {
        message: {
          content: 'ollama timeout caption',
        },
      },
    });

    await runtime.describeImage(IMAGE_URL);

    expect(httpClient.get.mock.calls[0][1].timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(getRequestOptions(apiClient).timeout).toBe(REQUEST_TIMEOUT_MS);
  },

  async assertPromptModelAndLimitPropagation({ provider }) {
    const { apiClient, httpClient, providerConfig, runtime } = createOllamaRuntime(provider);
    httpClient.get.mockResolvedValue(createImageAssetResponse());
    apiClient.post.mockResolvedValue({
      data: {
        message: {
          content: 'ollama config caption',
        },
      },
    });

    await runtime.describeImage(IMAGE_URL);

    expect(getRequestBody(apiClient)).toMatchObject({
      keep_alive: providerConfig.keepAlive,
      model: providerConfig.model,
      messages: [
        {
          content: providerConfig.prompt,
          images: [IMAGE_BYTES.toString('base64')],
          role: 'user',
        },
      ],
    });
  },
};

const createReplicateRuntime = (provider) => {
  const logger = createLogger();
  const replicateClient = {
    predictions: {
      cancel: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      get: jest.fn(),
    },
  };
  const providerConfig = {
    apiToken: 'replicate-contract-token',
    modelOwner: 'contract-owner',
    modelName: 'contract-model',
    modelVersion: 'contract-version',
    pollIntervalMs: 10,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  };
  const runtime = provider.createRuntime({
    config: {
      [provider.configKey]: providerConfig,
    },
    logger,
    outboundClients: {
      fetch: jest.fn(),
    },
    requestOptions: {
      timeout: REQUEST_TIMEOUT_MS,
    },
    providerClient: replicateClient,
  });

  return {
    logger,
    providerConfig,
    replicateClient,
    runtime,
  };
};

const replicateContract = {
  async assertSuccessfulNormalization({ provider }) {
    const { replicateClient, runtime } = createReplicateRuntime(provider);
    replicateClient.predictions.create.mockResolvedValue({
      id: 'replicate-contract-success',
      status: 'starting',
    });
    replicateClient.predictions.get.mockResolvedValue({
      id: 'replicate-contract-success',
      output: ['replicate ', 'normalized caption'],
      status: 'succeeded',
    });

    await expect(runtime.describeImage(IMAGE_URL)).resolves.toEqual({
      description: 'replicate normalized caption',
      imageUrl: IMAGE_URL,
    });
  },

  async assertSkippableImageSourceFailure({ provider }) {
    const { runtime } = createReplicateRuntime(provider);
    const error = new Error('Replicate image source failed: unable to download image URL');

    expect(runtime.shouldSkipDescriptionError(error)).toBe(true);
  },

  async assertNonSkippableProviderFailureMapping({ provider }) {
    const { logger, replicateClient, runtime } = createReplicateRuntime(provider);
    const error = new Error('Replicate provider rate limit exceeded');
    error.response = {
      status: 429,
      statusText: 'Too Many Requests',
    };
    replicateClient.predictions.create.mockRejectedValue(error);

    await expect(runtime.describeImage(IMAGE_URL)).rejects.toThrow(error.message);
    expect(runtime.shouldSkipDescriptionError(error)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      err: error,
      imageUrl: IMAGE_URL,
      modelRef: 'contract-owner/contract-model:contract-version',
      provider: provider.key,
    }), 'Replicate prediction failed');
  },

  async assertTimeoutHandling({ provider }) {
    const { replicateClient, runtime } = createReplicateRuntime(provider);
    let now = 0;
    runtime.now = () => now;
    runtime.sleep = jest.fn(async (ms) => {
      now += ms;
    });
    replicateClient.predictions.create.mockResolvedValue({
      id: 'replicate-contract-timeout',
      status: 'starting',
    });
    replicateClient.predictions.get.mockResolvedValue({
      id: 'replicate-contract-timeout',
      status: 'processing',
    });

    await expect(runtime.describeImage(IMAGE_URL, { timeoutMs: 20 })).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
    expect(replicateClient.predictions.cancel).toHaveBeenCalledWith('replicate-contract-timeout');
  },

  async assertPromptModelAndLimitPropagation({ provider }) {
    const { providerConfig, replicateClient, runtime } = createReplicateRuntime(provider);
    replicateClient.predictions.create.mockResolvedValue({
      id: 'replicate-contract-config',
      status: 'starting',
    });

    await runtime.createDescriptionJob(IMAGE_URL);

    expect(runtime.buildModelRef()).toBe('contract-owner/contract-model:contract-version');
    expect(runtime.requestTimeoutMs).toBe(providerConfig.requestTimeoutMs);
    expect(runtime.pollIntervalMs).toBe(providerConfig.pollIntervalMs);
    expect(replicateClient.predictions.create).toHaveBeenCalledWith({
      input: {
        image: IMAGE_URL,
      },
      version: providerConfig.modelVersion,
    });
  },
};

const providerAdapterContracts = Object.freeze({
  replicate: replicateContract,
  azure: azureContract,
  ollama: ollamaContract,
  huggingface: createOpenAiCompatibleContract(),
  openai: createOpenAiCompatibleContract(),
  openrouter: createOpenAiCompatibleContract(),
  together: createOpenAiCompatibleContract(),
});

module.exports = {
  assertEveryProviderIsRegistered,
  providerAdapterContracts,
  runProviderAdapterContractMatrix,
};
