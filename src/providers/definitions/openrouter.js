const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'openrouter',
  displayName: 'OpenRouter Vision',
  startupHint: 'OPENROUTER_API_KEY to enable openrouter',
  apiKeyEnvNames: ['OPENROUTER_API_KEY'],
  baseUrlEnvName: 'OPENROUTER_BASE_URL',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  modelEnvName: 'OPENROUTER_MODEL',
  defaultModel: 'google/gemma-3-4b-it:free',
  maxTokensEnvName: 'OPENROUTER_MAX_TOKENS',
  promptEnvName: 'OPENROUTER_PROMPT',
  providerValidation: {
    scopeKey: 'openrouter',
    autoPriority: 40,
    folderName: '90 Provider Validation',
    requestEnvVars: [
      'model=openrouter',
    ],
    providerIntegrationEnvVars: [
      'providerValidationImageUrl=http://127.0.0.1:19090/assets/a.png',
      'providerValidationPageUrl=http://127.0.0.1:19090/fixtures/page-with-images',
    ],
    scopeRequirement: 'OPENROUTER_API_KEY',
    allRequirement: 'OPENROUTER_API_KEY',
  },
  additionalEnvSchema: (Joi) => ({
    OPENROUTER_HTTP_REFERER: Joi.string().uri().optional(),
    OPENROUTER_TITLE: Joi.string().optional(),
  }),
  buildHeaders: (env) => ({
    ...(env.OPENROUTER_HTTP_REFERER ? { 'HTTP-Referer': env.OPENROUTER_HTTP_REFERER } : {}),
    ...(env.OPENROUTER_TITLE ? { 'X-Title': env.OPENROUTER_TITLE } : {}),
  }),
  additionalValidationEnvNames: ['OPENROUTER_HTTP_REFERER', 'OPENROUTER_TITLE'],
});
