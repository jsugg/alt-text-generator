const LOCAL_PROVIDER_VALIDATION_SCOPES = Object.freeze([
  'azure',
  'replicate',
  'huggingface',
  'openai',
  'openrouter',
]);

/**
 * @param {{ host: string, port: string|number }} options
 * @returns {{
 *   azureApiEndpoint: string,
 *   azureSubscriptionKey: string,
 *   hfApiKey: string,
 *   hfBaseUrl: string,
 *   openaiApiKey: string,
 *   openaiBaseUrl: string,
 *   openrouterApiKey: string,
 *   openrouterBaseUrl: string,
 *   replicateApiEndpoint: string,
 *   replicateApiToken: string,
 * }}
 */
function buildLocalMockProviderConfig(options) {
  const baseUrl = `http://${options.host}:${options.port}`;

  return {
    azureApiEndpoint: `${baseUrl}/vision/v3.2/describe`,
    azureSubscriptionKey: 'stub-azure-key',
    hfApiKey: 'stub-hf-key',
    hfBaseUrl: `${baseUrl}/huggingface/v1`,
    openaiApiKey: 'stub-openai-key',
    openaiBaseUrl: `${baseUrl}/openai/v1`,
    openrouterApiKey: 'stub-openrouter-key',
    openrouterBaseUrl: `${baseUrl}/openrouter/v1`,
    replicateApiEndpoint: baseUrl,
    replicateApiToken: 'stub-replicate-token',
  };
}

/**
 * @param {{ host: string, port: string|number }} options
 * @returns {{
 *   providerValidationAzureImageUrl: string,
 *   providerValidationAzurePageUrl: string,
 *   providerValidationImageUrl: string,
 *   providerValidationPageUrl: string,
 * }}
 */
function buildLocalMockProviderValidationFixtureUrls(options) {
  const baseUrl = `http://${options.host}:${options.port}`;

  return {
    providerValidationAzureImageUrl: `${baseUrl}/provider-validation/assets/a.png`,
    providerValidationAzurePageUrl: `${baseUrl}/provider-validation/page`,
    providerValidationImageUrl: `${baseUrl}/provider-validation/assets/a.png`,
    providerValidationPageUrl: `${baseUrl}/provider-validation/page`,
  };
}

module.exports = {
  buildLocalMockProviderConfig,
  buildLocalMockProviderValidationFixtureUrls,
  LOCAL_PROVIDER_VALIDATION_SCOPES,
};
