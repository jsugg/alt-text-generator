/**
 * Provider metadata shared across config loading, startup validation, runtime
 * registration, and provider-validation tooling.
 */
const PROVIDER_CATALOG = Object.freeze(require('../src/providers/definitions'));

/**
 * @typedef {object} ProviderDefinition
 * @property {string} key
 * @property {string} configKey
 * @property {(env: NodeJS.ProcessEnv) => object} buildConfig
 * @property {(Joi: any) => object} buildEnvSchema
 * @property {(env: NodeJS.ProcessEnv) => boolean} isConfiguredInEnv
 * @property {(config: object) => boolean} isConfiguredInConfig
 * @property {(env: NodeJS.ProcessEnv) => string[]} validateEnv
 * @property {(env: NodeJS.ProcessEnv) => Array<{ provider?: string, message?: string }>} [getStartupWarnings]
 * @property {{ scopeKey: string } & Record<string, any>} [providerValidation]
 */

/**
 * @typedef {ProviderDefinition & { providerValidation: { scopeKey: string } & Record<string, any> }} ProviderValidationDefinition
 */

/**
 * @typedef {Record<string, { enabled?: boolean }>} ProviderOverrides
 */

const getProviderCatalog = () => /** @type {ProviderDefinition[]} */ (PROVIDER_CATALOG.slice());

/**
 * @param {ProviderDefinition} provider
 * @param {ProviderOverrides} [providerOverrides]
 * @returns {boolean | undefined}
 */
const getProviderOverrideMode = (provider, providerOverrides = {}) => (
  providerOverrides[provider.key]?.enabled
  ?? providerOverrides[provider.configKey]?.enabled
);

/**
 * @param {ProviderDefinition} provider
 * @param {ProviderOverrides} [providerOverrides]
 * @returns {boolean}
 */
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
  /** @type {Record<string, object>} */
  const sections = {};

  getProviderCatalog().forEach((provider) => {
    sections[provider.configKey] = provider.buildConfig(env);
  });

  return sections;
};

/**
 * @param {any} Joi
 * @returns {object}
 */
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

/**
 * @param {{ providerOverrides?: ProviderOverrides }} [config]
 */
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

const getProviderValidationProviders = () => /** @type {ProviderValidationDefinition[]} */ (
  getProviderCatalog().filter((provider) => provider.providerValidation)
);

const getAvailableProviderValidationScopes = () => getProviderValidationProviders()
  .map((provider) => provider.providerValidation.scopeKey);

/**
 * @param {string} scopeKey
 * @returns {ProviderValidationDefinition | undefined}
 */
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
