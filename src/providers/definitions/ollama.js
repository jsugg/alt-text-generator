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
  buildEnvSchema: (/** @type {import('joi').Root} */ Joi) => ({
    OLLAMA_BASE_URL: Joi.string().uri().optional(),
    OLLAMA_MODEL: Joi.string().optional(),
    OLLAMA_PROMPT: Joi.string().optional(),
    OLLAMA_KEEP_ALIVE: Joi.string().optional(),
  }),
  buildConfig: (/** @type {Record<string, string | undefined>} */ env) => ({
    enabled: hasAnyEnvValue(env, OLLAMA_ENABLEMENT_ENV_NAMES),
    baseUrl: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model: env.OLLAMA_MODEL || 'llama3.2-vision',
    prompt: env.OLLAMA_PROMPT || DEFAULT_ALT_TEXT_PROMPT,
    keepAlive: env.OLLAMA_KEEP_ALIVE,
  }),
  isConfiguredInEnv: (env = {}) => hasAnyEnvValue(env, OLLAMA_ENABLEMENT_ENV_NAMES),
  isConfiguredInConfig: (
    /** @type {{ ollama?: { enabled?: boolean } }} */ config = {},
  ) => Boolean(config.ollama?.enabled),
  validateEnv: () => [],
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
  }) => new OllamaDescriberService(/** @type {ConstructorParameters<typeof OllamaDescriberService>[0]} */ ({
    logger,
    httpClient,
    apiClient: providerClient ?? httpClient,
    outboundUrlPolicy,
    providerConfig: config.ollama,
    requestOptions,
  })),
};
