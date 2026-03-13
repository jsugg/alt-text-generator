const OpenAiCompatibleVisionDescriberService = require('../../services/OpenAiCompatibleVisionDescriberService');
const {
  DEFAULT_ALT_TEXT_PROMPT,
  hasAnyEnvValue,
  toPositiveIntegerOrFallback,
  validateApiKeyBackedProviderEnv,
} = require('./helpers');

/**
 * Builds a provider definition for OpenAI-compatible multimodal chat APIs.
 *
 * @param {object} options
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
  liveValidation = null,
  additionalEnvSchema = () => ({}),
  buildAdditionalConfig = () => ({}),
  buildHeaders = () => ({}),
  additionalValidationEnvNames = [],
}) => ({
  key,
  configKey,
  displayName,
  startupHint,
  buildEnvSchema: (Joi) => ({
    ...apiKeyEnvNames.reduce((schema, envName) => ({
      ...schema,
      [envName]: Joi.string().optional(),
    }), {}),
    [baseUrlEnvName]: Joi.string().uri().optional(),
    [modelEnvName]: Joi.string().optional(),
    [maxTokensEnvName]: Joi.number().integer().min(1).optional(),
    [promptEnvName]: Joi.string().optional(),
    ...additionalEnvSchema(Joi),
  }),
  buildConfig: (env) => {
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
  isConfiguredInConfig: (config = {}) => Boolean(config[configKey]?.apiKey),
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
  createRuntime: ({
    config,
    logger,
    httpClient,
    requestOptions,
    providerClient,
  }) => new OpenAiCompatibleVisionDescriberService({
    logger,
    httpClient,
    apiClient: providerClient ?? httpClient,
    providerConfig: config[configKey],
    providerKey: key,
    providerName: displayName,
    requestOptions,
  }),
  liveValidation,
});

module.exports = {
  buildOpenAiCompatibleProvider,
};
