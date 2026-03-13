const Joi = require('joi');

const {
  buildProviderConfigSections,
  buildProviderEnvSchema,
  getAvailableLiveProviderScopes,
  getConfiguredProvidersFromConfig,
  getConfiguredProvidersFromEnv,
  getLiveProviderByScope,
  getLiveValidationProviders,
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
    });
    expect(buildProviderConfigSections({
      ACV_MAX_CANDIDATES: '0',
    }).azure.maxCandidates).toBe(4);
  });

  it('builds the provider env schema and detects configured providers', () => {
    const schema = buildProviderEnvSchema(Joi);

    expect(schema).toHaveProperty('REPLICATE_API_TOKEN');
    expect(schema).toHaveProperty('ACV_API_ENDPOINT');
    expect(getConfiguredProvidersFromEnv({})).toEqual([]);
    expect(getConfiguredProvidersFromEnv({
      REPLICATE_API_TOKEN: 'replicate-token',
      ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
      ACV_SUBSCRIPTION_KEY: 'azure-key',
    }).map((provider) => provider.key)).toEqual(['clip', 'azure']);
    expect(getConfiguredProvidersFromConfig({
      replicate: { apiToken: 'replicate-token' },
      azure: {},
    }).map((provider) => provider.key)).toEqual(['clip']);
  });

  it('validates provider-specific env rules and exposes live-provider metadata', () => {
    const errors = validateProviderEnv({
      ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ACV_API_ENDPOINT and ACV_SUBSCRIPTION_KEY/);
    expect(validateProviderEnv({
      ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
      ACV_SUBSCRIPTION_KEY: 'azure-key',
    })).toEqual([]);
    expect(getProviderCatalog().map((provider) => provider.key)).toEqual(['clip', 'azure']);
    expect(getLiveValidationProviders().map((provider) => provider.liveValidation.scopeKey))
      .toEqual(['replicate', 'azure']);
    expect(getAvailableLiveProviderScopes()).toEqual(['replicate', 'azure']);
    expect(getLiveProviderByScope('azure').displayName).toBe('Azure Computer Vision');
  });
});
