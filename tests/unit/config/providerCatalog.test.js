const Joi = require('joi');

const {
  buildProviderConfigSections,
  buildProviderEnvSchema,
  getAvailableProviderValidationScopes,
  getConfiguredProvidersFromConfig,
  getConfiguredProvidersFromEnv,
  getProviderValidationByScope,
  getProviderValidationProviders,
  getProviderCatalog,
  validateProviderEnv,
} = require('../../../config/providerCatalog');

describe('Unit | Config | Provider Catalog', () => {
  it('builds provider config sections with documented defaults and explicit overrides', () => {
    const sections = buildProviderConfigSections({
      REPLICATE_API_TOKEN: 'replicate-token',
      REPLICATE_API_ENDPOINT: 'https://replicate.example.com',
      REPLICATE_USER_AGENT: 'alt-text-generator/test',
      REPLICATE_MODEL_OWNER: 'owner',
      REPLICATE_MODEL_NAME: 'model',
      REPLICATE_MODEL_VERSION: 'version',
      ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
      ACV_SUBSCRIPTION_KEY: 'azure-key',
      ACV_LANGUAGE: 'pt-BR',
      ACV_MAX_CANDIDATES: '7',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_MODEL: 'gpt-4.1-mini',
      HF_API_KEY: 'hf-key',
      OLLAMA_MODEL: 'llama3.2-vision',
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_HTTP_REFERER: 'https://example.com',
      OPENROUTER_TITLE: 'Alt Text 4 All',
      TOGETHER_API_KEY: 'together-key',
    });

    expect(sections).toEqual({
      replicate: {
        apiToken: 'replicate-token',
        apiEndpoint: 'https://replicate.example.com',
        userAgent: 'alt-text-generator/test',
        modelOwner: 'owner',
        modelName: 'model',
        modelVersion: 'version',
      },
      azure: {
        apiEndpoint: 'https://azure.example.com/vision/v3.2/describe',
        subscriptionKey: 'azure-key',
        language: 'pt-BR',
        maxCandidates: 7,
      },
      ollama: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.2-vision',
        prompt: expect.any(String),
        keepAlive: undefined,
      },
      huggingface: {
        apiKey: 'hf-key',
        baseUrl: 'https://router.huggingface.co/v1',
        model: 'Qwen/Qwen3-VL-30B-A3B-Instruct:novita',
        maxTokens: 160,
        prompt: expect.any(String),
        headers: {},
      },
      openai: {
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        maxTokens: 160,
        prompt: expect.any(String),
        headers: {},
      },
      openrouter: {
        apiKey: 'openrouter-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'google/gemma-3-4b-it:free',
        maxTokens: 160,
        prompt: expect.any(String),
        headers: {
          'HTTP-Referer': 'https://example.com',
          'X-Title': 'Alt Text 4 All',
        },
      },
      together: {
        apiKey: 'together-key',
        baseUrl: 'https://api.together.xyz/v1',
        model: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
        maxTokens: 160,
        prompt: expect.any(String),
        headers: {},
      },
    });
    expect(buildProviderConfigSections({
      ACV_MAX_CANDIDATES: '0',
    }).azure.maxCandidates).toBe(4);
  });

  it('builds the provider env schema and detects configured providers', () => {
    const schema = buildProviderEnvSchema(Joi);

    expect(schema).toHaveProperty('REPLICATE_API_TOKEN');
    expect(schema).toHaveProperty('ACV_API_ENDPOINT');
    expect(schema).toHaveProperty('OPENAI_API_KEY');
    expect(schema).toHaveProperty('HF_API_KEY');
    expect(schema).toHaveProperty('OLLAMA_MODEL');
    expect(schema).toHaveProperty('OPENROUTER_API_KEY');
    expect(schema).toHaveProperty('TOGETHER_API_KEY');
    expect(getConfiguredProvidersFromEnv({})).toEqual([]);
    expect(getConfiguredProvidersFromEnv({
      REPLICATE_API_TOKEN: 'replicate-token',
      ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
      ACV_SUBSCRIPTION_KEY: 'azure-key',
      OPENAI_API_KEY: 'openai-key',
      HF_TOKEN: 'hf-token',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      OPENROUTER_API_KEY: 'openrouter-key',
      TOGETHER_API_KEY: 'together-key',
    }).map((provider) => provider.key)).toEqual([
      'clip',
      'azure',
      'ollama',
      'huggingface',
      'openai',
      'openrouter',
      'together',
    ]);
    expect(getConfiguredProvidersFromConfig({
      replicate: { apiToken: 'replicate-token' },
      azure: {},
      openai: { apiKey: 'openai-key' },
      huggingface: { apiKey: 'hf-key' },
      ollama: { enabled: true },
    }).map((provider) => provider.key)).toEqual(['clip', 'ollama', 'huggingface', 'openai']);
  });

  it('validates provider-specific env rules and exposes provider-validation metadata', () => {
    const errors = validateProviderEnv({
      ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ACV_API_ENDPOINT and ACV_SUBSCRIPTION_KEY/);
    expect(validateProviderEnv({
      ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
      ACV_SUBSCRIPTION_KEY: 'azure-key',
    })).toEqual([]);
    expect(validateProviderEnv({
      OPENAI_MODEL: 'gpt-4.1-mini',
    })[0]).toMatch(/OPENAI_API_KEY/);
    expect(validateProviderEnv({
      OPENROUTER_TITLE: 'Alt Text 4 All',
    })[0]).toMatch(/OPENROUTER_API_KEY/);
    expect(getProviderCatalog().map((provider) => provider.key)).toEqual([
      'clip',
      'azure',
      'ollama',
      'huggingface',
      'openai',
      'openrouter',
      'together',
    ]);
    expect(
      getProviderValidationProviders().map((provider) => provider.providerValidation.scopeKey),
    ).toEqual(['replicate', 'azure', 'huggingface', 'openai', 'openrouter']);
    expect(getAvailableProviderValidationScopes()).toEqual([
      'replicate',
      'azure',
      'huggingface',
      'openai',
      'openrouter',
    ]);
    expect(getProviderValidationByScope('azure').displayName).toBe('Azure Computer Vision');
  });
});
