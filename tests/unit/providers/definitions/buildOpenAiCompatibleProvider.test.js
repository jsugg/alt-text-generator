const Joi = require('joi');

const {
  buildOpenAiCompatibleProvider,
} = require('../../../../src/providers/definitions/buildOpenAiCompatibleProvider');

describe('Unit | Providers | Definitions | Build OpenAI Compatible Provider', () => {
  const buildProvider = () => buildOpenAiCompatibleProvider({
    key: 'demo',
    configKey: 'demo',
    displayName: 'Demo Provider',
    startupHint: 'DEMO_API_KEY to enable demo',
    apiKeyEnvNames: ['DEMO_API_KEY', 'DEMO_TOKEN'],
    baseUrlEnvName: 'DEMO_BASE_URL',
    defaultBaseUrl: 'https://api.example.com/v1',
    modelEnvName: 'DEMO_MODEL',
    defaultModel: 'demo-model',
    maxTokensEnvName: 'DEMO_MAX_TOKENS',
    promptEnvName: 'DEMO_PROMPT',
    liveValidation: {
      scopeKey: 'demo',
      autoPriority: 50,
      folderName: '90 Live Provider Validation',
      scopeRequirement: 'DEMO_API_KEY',
      allRequirement: 'DEMO_API_KEY',
    },
    additionalEnvSchema: (schemaBuilder) => ({
      DEMO_HEADER: schemaBuilder.string().optional(),
    }),
    buildHeaders: (env) => ({
      ...(env.DEMO_HEADER ? { 'X-Demo': env.DEMO_HEADER } : {}),
    }),
    additionalValidationEnvNames: ['DEMO_HEADER'],
  });

  it('builds env schema and config defaults', () => {
    const provider = buildProvider();
    const schema = provider.buildEnvSchema(Joi);
    const config = provider.buildConfig({
      DEMO_TOKEN: 'demo-token',
      DEMO_HEADER: 'header-value',
    });

    expect(schema).toHaveProperty('DEMO_API_KEY');
    expect(schema).toHaveProperty('DEMO_HEADER');
    expect(config).toEqual({
      apiKey: 'demo-token',
      baseUrl: 'https://api.example.com/v1',
      model: 'demo-model',
      maxTokens: 160,
      prompt: expect.any(String),
      headers: {
        'X-Demo': 'header-value',
      },
    });
  });

  it('detects configuration and validates missing api keys for dependent overrides', () => {
    const provider = buildProvider();

    expect(provider.isConfiguredInEnv({ DEMO_API_KEY: 'key' })).toBe(true);
    expect(provider.isConfiguredInConfig({ demo: { apiKey: 'key' } })).toBe(true);
    expect(provider.validateEnv({ DEMO_MODEL: 'override-model' })[0]).toMatch(/DEMO_API_KEY/);
    expect(provider.validateEnv({})).toEqual([]);
  });

  it('creates a runtime describer and prefers an injected provider client', () => {
    const provider = buildProvider();
    const httpClient = {
      get: jest.fn(),
      post: jest.fn(),
    };
    const providerClient = {
      post: jest.fn(),
    };
    const runtime = provider.createRuntime({
      config: {
        demo: {
          apiKey: 'demo-key',
          baseUrl: 'https://api.example.com/v1',
          model: 'demo-model',
          maxTokens: 100,
          prompt: 'Describe this image.',
          headers: {},
        },
      },
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
      },
      httpClient,
      requestOptions: {
        timeout: 500,
      },
      providerClient,
    });

    expect(runtime.providerKey).toBe('demo');
    expect(runtime.apiClient).toBe(providerClient);
    expect(runtime.httpClient).toBe(httpClient);
  });

  it('preserves live validation metadata on the provider definition', () => {
    const provider = buildProvider();

    expect(provider.liveValidation).toEqual({
      scopeKey: 'demo',
      autoPriority: 50,
      folderName: '90 Live Provider Validation',
      scopeRequirement: 'DEMO_API_KEY',
      allRequirement: 'DEMO_API_KEY',
    });
  });
});
