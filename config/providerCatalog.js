/**
 * Provider metadata shared across config loading, startup validation, and
 * live-provider tooling.
 */
const toPositiveIntegerOrFallback = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const PROVIDER_CATALOG = Object.freeze([
  {
    key: 'clip',
    configKey: 'replicate',
    displayName: 'Replicate CLIP',
    startupHint: 'REPLICATE_API_TOKEN to enable clip',
    buildEnvSchema: (Joi) => ({
      REPLICATE_API_TOKEN: Joi.string().optional(),
      REPLICATE_API_ENDPOINT: Joi.string().uri().optional(),
      REPLICATE_USER_AGENT: Joi.string().optional(),
      REPLICATE_MODEL_OWNER: Joi.string().optional(),
      REPLICATE_MODEL_NAME: Joi.string().optional(),
      REPLICATE_MODEL_VERSION: Joi.string().optional(),
    }),
    buildConfig: (env) => ({
      apiToken: env.REPLICATE_API_TOKEN,
      apiEndpoint: env.REPLICATE_API_ENDPOINT,
      userAgent: env.REPLICATE_USER_AGENT || 'alt-text-generator/1.0.0',
      modelOwner: env.REPLICATE_MODEL_OWNER || 'rmokady',
      modelName: env.REPLICATE_MODEL_NAME || 'clip_prefix_caption',
      modelVersion:
        env.REPLICATE_MODEL_VERSION
        || '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8',
    }),
    isConfiguredInEnv: (env = {}) => Boolean(env.REPLICATE_API_TOKEN),
    isConfiguredInConfig: (config = {}) => Boolean(config.replicate?.apiToken),
    validateEnv: () => [],
    liveValidation: {
      scopeKey: 'replicate',
      autoPriority: 20,
      folderName: '90 Live Provider Validation',
      scopeRequirement: 'REPLICATE_API_TOKEN',
      allRequirement: 'REPLICATE_API_TOKEN',
    },
  },
  {
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
  },
]);

const getProviderCatalog = () => PROVIDER_CATALOG.slice();

/**
 * Builds the provider-specific sections merged into the runtime config object.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, object>}
 */
const buildProviderConfigSections = (env = process.env) => {
  const sections = {};

  getProviderCatalog().forEach((provider) => {
    sections[provider.configKey] = provider.buildConfig(env);
  });

  return sections;
};

const buildProviderEnvSchema = (Joi) => getProviderCatalog().reduce((schema, provider) => ({
  ...schema,
  ...provider.buildEnvSchema(Joi),
}), {});

const getConfiguredProvidersFromEnv = (env = process.env) => getProviderCatalog()
  .filter((provider) => provider.isConfiguredInEnv(env));

const getConfiguredProvidersFromConfig = (config = {}) => getProviderCatalog()
  .filter((provider) => provider.isConfiguredInConfig(config));

const validateProviderEnv = (env = process.env) => getProviderCatalog()
  .flatMap((provider) => provider.validateEnv(env));

const getLiveValidationProviders = () => getProviderCatalog()
  .filter((provider) => provider.liveValidation);

const getAvailableLiveProviderScopes = () => getLiveValidationProviders()
  .map((provider) => provider.liveValidation.scopeKey);

const getLiveProviderByScope = (scopeKey) => getLiveValidationProviders()
  .find((provider) => provider.liveValidation.scopeKey === scopeKey);

module.exports = {
  buildProviderConfigSections,
  buildProviderEnvSchema,
  getAvailableLiveProviderScopes,
  getConfiguredProvidersFromConfig,
  getConfiguredProvidersFromEnv,
  getLiveProviderByScope,
  getLiveValidationProviders,
  getProviderCatalog,
  validateProviderEnv,
};
