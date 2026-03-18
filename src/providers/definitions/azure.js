const AzureDescriberService = require('../../services/AzureDescriberService');
const {
  hasNonEmptyStringValue,
  toPositiveIntegerOrFallback,
} = require('./helpers');

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
    enabled:
      hasNonEmptyStringValue(env.ACV_API_ENDPOINT)
      && hasNonEmptyStringValue(env.ACV_SUBSCRIPTION_KEY),
    apiEndpoint: env.ACV_API_ENDPOINT,
    subscriptionKey: env.ACV_SUBSCRIPTION_KEY,
    language: env.ACV_LANGUAGE || 'en',
    maxCandidates: toPositiveIntegerOrFallback(env.ACV_MAX_CANDIDATES, 4),
  }),
  isConfiguredInEnv: (env = {}) => Boolean(
    hasNonEmptyStringValue(env.ACV_API_ENDPOINT)
    && hasNonEmptyStringValue(env.ACV_SUBSCRIPTION_KEY),
  ),
  isConfiguredInConfig: (config = {}) => Boolean(
    config.azure?.enabled !== false
    && hasNonEmptyStringValue(config.azure?.apiEndpoint)
    && hasNonEmptyStringValue(config.azure?.subscriptionKey),
  ),
  validateEnv: () => [],
  getStartupWarnings: (env = {}) => {
    const hasAzureEndpoint = hasNonEmptyStringValue(env.ACV_API_ENDPOINT);
    const hasAzureCredential = hasNonEmptyStringValue(env.ACV_SUBSCRIPTION_KEY);

    if (hasAzureEndpoint === hasAzureCredential) {
      return [];
    }

    return [{
      provider: 'azure',
      message: 'Azure provider disabled for this run because ACV_API_ENDPOINT and '
        + 'ACV_SUBSCRIPTION_KEY must both be set and non-empty.',
    }];
  },
  providerValidation: {
    scopeKey: 'azure',
    autoPriority: 10,
    folderName: '91 Azure Provider Validation',
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
