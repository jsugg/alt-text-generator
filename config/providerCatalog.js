/**
 * Provider metadata shared across config loading, startup validation, runtime
 * registration, and provider-validation tooling.
 */
const PROVIDER_CATALOG = Object.freeze(require('../src/providers/definitions'));

const getProviderCatalog = () => PROVIDER_CATALOG.slice();

const getProviderOverrideMode = (provider, providerOverrides = {}) => (
  providerOverrides[provider.key]?.enabled
  ?? providerOverrides[provider.configKey]?.enabled
);

const isProviderEnabledByOverride = (provider, providerOverrides = {}) => (
  getProviderOverrideMode(provider, providerOverrides) !== false
);

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

const getConfiguredProvidersFromEnv = (env = process.env, { providerOverrides = {} } = {}) => (
  getProviderCatalog()
    .filter((provider) => (
      isProviderEnabledByOverride(provider, providerOverrides)
      && provider.isConfiguredInEnv(env)
    ))
);

const getConfiguredProvidersFromConfig = (config = {}) => {
  const providerOverrides = config.providerOverrides || {};

  return getProviderCatalog()
    .filter((provider) => (
      isProviderEnabledByOverride(provider, providerOverrides)
      && provider.isConfiguredInConfig(config)
    ));
};

const validateProviderEnv = (env = process.env) => getProviderCatalog()
  .flatMap((provider) => provider.validateEnv(env));

const getProviderStartupWarnings = (env = process.env, { providerOverrides = {} } = {}) => (
  getProviderCatalog().flatMap((provider) => {
    if (!isProviderEnabledByOverride(provider, providerOverrides)) {
      return [];
    }

    return typeof provider.getStartupWarnings === 'function'
      ? provider.getStartupWarnings(env)
      : [];
  })
);

const getProviderValidationProviders = () => getProviderCatalog()
  .filter((provider) => provider.providerValidation);

const getAvailableProviderValidationScopes = () => getProviderValidationProviders()
  .map((provider) => provider.providerValidation.scopeKey);

const getProviderValidationByScope = (scopeKey) => getProviderValidationProviders()
  .find((provider) => provider.providerValidation.scopeKey === scopeKey);

module.exports = {
  getProviderCatalog,
  buildProviderConfigSections,
  buildProviderEnvSchema,
  getProviderStartupWarnings,
  validateProviderEnv,
  getConfiguredProvidersFromEnv,
  getConfiguredProvidersFromConfig,
  getProviderValidationProviders,
  getAvailableProviderValidationScopes,
  getProviderValidationByScope,
};
