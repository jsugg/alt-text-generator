const {
  buildLocalMockProviderConfig,
  buildLocalMockProviderValidationFixtureUrls,
  LOCAL_PROVIDER_VALIDATION_SCOPES,
} = require('../../../../scripts/postman/local-provider-mocks');

describe('Unit | Scripts | Postman | Local Provider Mocks', () => {
  it('defines the mocked provider scopes used by the full local suite', () => {
    expect(LOCAL_PROVIDER_VALIDATION_SCOPES).toEqual([
      'azure',
      'replicate',
      'huggingface',
      'openai',
      'openrouter',
    ]);
  });

  it('builds local mock provider configuration URLs', () => {
    expect(buildLocalMockProviderConfig({ host: '127.0.0.1', port: 19090 })).toEqual({
      azureApiEndpoint: 'http://127.0.0.1:19090/vision/v3.2/describe',
      azureSubscriptionKey: 'stub-azure-key',
      hfApiKey: 'stub-hf-key',
      hfBaseUrl: 'http://127.0.0.1:19090/huggingface/v1',
      openaiApiKey: 'stub-openai-key',
      openaiBaseUrl: 'http://127.0.0.1:19090/openai/v1',
      openrouterApiKey: 'stub-openrouter-key',
      openrouterBaseUrl: 'http://127.0.0.1:19090/openrouter/v1',
      replicateApiEndpoint: 'http://127.0.0.1:19090',
      replicateApiToken: 'stub-replicate-token',
    });
  });

  it('builds local provider-validation fixture URLs', () => {
    expect(buildLocalMockProviderValidationFixtureUrls({ host: '127.0.0.1', port: 19090 })).toEqual({
      providerValidationAzureImageUrl: 'http://127.0.0.1:19090/provider-validation/assets/a.png',
      providerValidationAzurePageUrl: 'http://127.0.0.1:19090/provider-validation/page',
      providerValidationImageUrl: 'http://127.0.0.1:19090/provider-validation/assets/a.png',
      providerValidationPageUrl: 'http://127.0.0.1:19090/provider-validation/page',
    });
  });
});
