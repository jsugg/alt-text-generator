const AzureDescriberService = require('../../services/AzureDescriberService');
const { toPositiveIntegerOrFallback } = require('./helpers');

module.exports = {
  key: 'azure',
  configKey: 'azure',
  displayName: 'Azure Computer Vision',
  startupHint: 'ACV_API_ENDPOINT and ACV_SUBSCRIPTION_KEY to enable azure',
  buildEnvSchema: (Joi) => ({
    ACV_API_ENDPOINT: Joi.string().uri().optional(),
    ACV_SUBSCRIPTION_KEY: Joi.string().optional(),
    ACV_LANGUAGE: Joi.string().optional(),
    ACV_MAX_CANDIDATES: Joi.number().integer().min(1).optional(),
  }),
  buildConfig: (env) => ({
    apiEndpoint: env.ACV_API_ENDPOINT,
    subscriptionKey: env.ACV_SUBSCRIPTION_KEY,
    language: env.ACV_LANGUAGE || 'en',
    maxCandidates: toPositiveIntegerOrFallback(env.ACV_MAX_CANDIDATES, 4),
  }),
  isConfiguredInEnv: (env = {}) => Boolean(
    env.ACV_API_ENDPOINT && env.ACV_SUBSCRIPTION_KEY,
  ),
  isConfiguredInConfig: (config = {}) => Boolean(
    config.azure?.apiEndpoint && config.azure?.subscriptionKey,
  ),
  validateEnv: (env = {}) => {
    const hasAzureEndpoint = Boolean(env.ACV_API_ENDPOINT);
    const hasAzureCredential = Boolean(env.ACV_SUBSCRIPTION_KEY);

    if (hasAzureEndpoint !== hasAzureCredential) {
      return [
        'Config validation error: ACV_API_ENDPOINT and ACV_SUBSCRIPTION_KEY '
          + 'must be set together to enable the Azure provider',
      ];
    }

    return [];
  },
  liveValidation: {
    scopeKey: 'azure',
    autoPriority: 10,
    folderName: '91 Live Azure Validation',
    scopeRequirement: 'ACV_API_ENDPOINT and ACV_SUBSCRIPTION_KEY',
    allRequirement: 'Azure credentials',
  },
  createRuntime: ({
    config,
    logger,
    httpClient,
    requestOptions,
  }) => new AzureDescriberService({
    logger,
    httpClient,
    providerConfig: config.azure,
    requestOptions,
  }),
};
