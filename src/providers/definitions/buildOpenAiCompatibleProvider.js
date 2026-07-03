const OpenAiCompatibleVisionDescriberService = require('../../services/OpenAiCompatibleVisionDescriberService');
const {
  DEFAULT_ALT_TEXT_PROMPT,
  hasAnyEnvValue,
  toPositiveIntegerOrFallback,
  validateApiKeyBackedProviderEnv,
} = require('./helpers');

/**
 * @typedef {object} OpenAiCompatibleProviderOptions
 * @property {string} key
 * @property {string} [configKey]
 * @property {string} displayName
 * @property {string} startupHint
 * @property {string[]} apiKeyEnvNames
 * @property {string} baseUrlEnvName
 * @property {string} [defaultBaseUrl]
 * @property {string} modelEnvName
 * @property {string} [defaultModel]
 * @property {string} maxTokensEnvName
 * @property {string} promptEnvName
 * @property {object | null} [providerValidation]
 * @property {(Joi: import('joi').Root) => Record<string, unknown>} [additionalEnvSchema]
 * @property {(env: Record<string, string | undefined>) => Record<string, unknown>} [buildAdditionalConfig]
 * @property {(env: Record<string, string | undefined>) => Record<string, string>} [buildHeaders]
 * @property {string[]} [additionalValidationEnvNames]
 */

/**
 * Builds a provider definition for OpenAI-compatible multimodal chat APIs.
 *
 * @param {OpenAiCompatibleProviderOptions} options
 * @returns {object}
 */
const buildOpenAiCompatibleProvider = ({
  key,
  configKey = key,
  displayName,
  startupHint,
  apiKeyEnvNames,
  baseUrlEnvName,
  defaultBaseUrl,
  modelEnvName,
  defaultModel,
  maxTokensEnvName,
  promptEnvName,
  providerValidation = null,
  additionalEnvSchema = () => ({}),
  buildAdditionalConfig = () => ({}),
  buildHeaders = () => ({}),
  additionalValidationEnvNames = [],
}) => ({
  key,
  configKey,
  displayName,
  startupHint,
  buildEnvSchema: (/** @type {import('joi').Root} */ Joi) => ({
    ...apiKeyEnvNames.reduce((schema, envName) => ({
      ...schema,
      [envName]: Joi.string().optional(),
    }), /** @type {Record<string, unknown>} */ ({})),
    [baseUrlEnvName]: Joi.string().uri().optional(),
    [modelEnvName]: Joi.string().optional(),
    [maxTokensEnvName]: Joi.number().integer().min(1).optional(),
    [promptEnvName]: Joi.string().optional(),
    ...additionalEnvSchema(Joi),
  }),
  buildConfig: (/** @type {Record<string, string | undefined>} */ env) => {
    const apiKeyEnvName = apiKeyEnvNames.find((envName) => env[envName]);

    return {
      apiKey: apiKeyEnvName ? env[apiKeyEnvName] : undefined,
      baseUrl: env[baseUrlEnvName] || defaultBaseUrl,
      model: env[modelEnvName] || defaultModel,
      maxTokens: toPositiveIntegerOrFallback(env[maxTokensEnvName], 160),
      prompt: env[promptEnvName] || DEFAULT_ALT_TEXT_PROMPT,
      headers: buildHeaders(env),
      ...buildAdditionalConfig(env),
    };
  },
  isConfiguredInEnv: (env = {}) => hasAnyEnvValue(env, apiKeyEnvNames),
  isConfiguredInConfig: (/** @type {Record<string, { apiKey?: unknown }>} */ config = {}) => Boolean(config[configKey]?.apiKey),
  validateEnv: (env = {}) => validateApiKeyBackedProviderEnv({
    env,
    apiKeyEnvNames,
    dependentEnvNames: [
      baseUrlEnvName,
      modelEnvName,
      maxTokensEnvName,
      promptEnvName,
      ...additionalValidationEnvNames,
    ],
    errorMessage: `Config validation error: ${startupHint}`,
  }),
  /**
   * @param {{ config: Record<string, object>, logger: object, httpClient: object, outboundUrlPolicy?: Function, requestOptions?: object, providerClient?: object }} deps
   */
  createRuntime: ({
    config,
    logger,
    httpClient,
    outboundUrlPolicy,
    requestOptions,
    providerClient,
  }) => new OpenAiCompatibleVisionDescriberService(/** @type {ConstructorParameters<typeof OpenAiCompatibleVisionDescriberService>[0]} */ ({
    logger,
    httpClient,
    apiClient: providerClient ?? httpClient,
    outboundUrlPolicy,
    providerConfig: config[configKey],
    providerKey: key,
    providerName: displayName,
    requestOptions,
  })),
  providerValidation,
});

module.exports = {
  buildOpenAiCompatibleProvider,
};
