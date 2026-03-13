const OllamaDescriberService = require('../../services/OllamaDescriberService');
const {
  DEFAULT_ALT_TEXT_PROMPT,
  hasAnyEnvValue,
} = require('./helpers');

const OLLAMA_ENABLEMENT_ENV_NAMES = [
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OLLAMA_PROMPT',
  'OLLAMA_KEEP_ALIVE',
];

module.exports = {
  key: 'ollama',
  configKey: 'ollama',
  displayName: 'Ollama Vision',
  startupHint: 'OLLAMA_MODEL or OLLAMA_BASE_URL to enable ollama',
  buildEnvSchema: (Joi) => ({
    OLLAMA_BASE_URL: Joi.string().uri().optional(),
    OLLAMA_MODEL: Joi.string().optional(),
    OLLAMA_PROMPT: Joi.string().optional(),
    OLLAMA_KEEP_ALIVE: Joi.string().optional(),
  }),
  buildConfig: (env) => ({
    enabled: hasAnyEnvValue(env, OLLAMA_ENABLEMENT_ENV_NAMES),
    baseUrl: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model: env.OLLAMA_MODEL || 'llama3.2-vision',
    prompt: env.OLLAMA_PROMPT || DEFAULT_ALT_TEXT_PROMPT,
    keepAlive: env.OLLAMA_KEEP_ALIVE,
  }),
  isConfiguredInEnv: (env = {}) => hasAnyEnvValue(env, OLLAMA_ENABLEMENT_ENV_NAMES),
  isConfiguredInConfig: (config = {}) => Boolean(config.ollama?.enabled),
  validateEnv: () => [],
  createRuntime: ({
    config,
    logger,
    httpClient,
    requestOptions,
    providerClient,
  }) => new OllamaDescriberService({
    logger,
    httpClient,
    apiClient: providerClient ?? httpClient,
    providerConfig: config.ollama,
    requestOptions,
  }),
};
