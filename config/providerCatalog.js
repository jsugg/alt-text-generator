/**
 * Provider metadata shared across config loading, startup validation, runtime
 * registration, and live-provider tooling.
 */
const PROVIDER_CATALOG = Object.freeze(require('../src/providers/definitions'));

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
