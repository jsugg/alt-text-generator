/**
 * Provider metadata shared across config loading, startup validation, runtime
 * registration, and provider-validation tooling.
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
  validateProviderEnv,
  getConfiguredProvidersFromEnv,
  getConfiguredProvidersFromConfig,
  getProviderValidationProviders,
  getAvailableProviderValidationScopes,
  getProviderValidationByScope,
};
