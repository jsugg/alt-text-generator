const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'openai',
  displayName: 'OpenAI Vision',
  startupHint: 'OPENAI_API_KEY to enable openai',
  apiKeyEnvNames: ['OPENAI_API_KEY'],
  baseUrlEnvName: 'OPENAI_BASE_URL',
  defaultBaseUrl: 'https://api.openai.com/v1',
  modelEnvName: 'OPENAI_MODEL',
  defaultModel: 'gpt-4.1-nano',
  maxTokensEnvName: 'OPENAI_MAX_TOKENS',
  promptEnvName: 'OPENAI_PROMPT',
  providerValidation: {
    scopeKey: 'openai',
    autoPriority: 50,
    folderName: '90 Provider Validation',
    requestEnvVars: ['model=openai'],
    scopeRequirement: 'OPENAI_API_KEY',
    allRequirement: 'OPENAI_API_KEY',
  },
});
