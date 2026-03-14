const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'openai',
  displayName: 'OpenAI Vision',
  startupHint: 'OPENAI_API_KEY to enable openai',
  apiKeyEnvNames: ['OPENAI_API_KEY'],
  baseUrlEnvName: 'OPENAI_BASE_URL',
  defaultBaseUrl: 'https://api.openai.com/v1',
  modelEnvName: 'OPENAI_MODEL',
  defaultModel: 'gpt-4.1-mini',
  maxTokensEnvName: 'OPENAI_MAX_TOKENS',
  promptEnvName: 'OPENAI_PROMPT',
  providerValidation: {
    scopeKey: 'openai',
    autoPriority: 50,
    folderName: '90 Provider Validation',
    requestEnvVars: ['model=openai'],
    providerIntegrationEnvVars: [
      'providerValidationImageUrl=http://127.0.0.1:19090/assets/a.png',
      'providerValidationPageUrl=http://127.0.0.1:19090/fixtures/page-with-images',
    ],
    scopeRequirement: 'OPENAI_API_KEY',
    allRequirement: 'OPENAI_API_KEY',
  },
});
