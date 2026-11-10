const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'openai',
  displayName: 'OpenAI Vision',
  startupHint: 'OPENAI_API_KEY to enable openai',
  apiKeyEnvNames: ['OPENAI_API_KEY'],
  baseUrlEnvName: 'OPENAI_BASE_URL',
  defaultBaseUrl: 'https://api.openai.com/v1',
  modelEnvName: 'OPENAI_MODEL',
  defaultModel: 'gpt-5.4-nano',
  maxTokensEnvName: 'OPENAI_MAX_TOKENS',
  promptEnvName: 'OPENAI_PROMPT',
  // gpt-5.x rejects max_tokens; max_completion_tokens is accepted by every current chat model.
  buildAdditionalConfig: () => ({ maxTokensParam: 'max_completion_tokens' }),
  providerValidation: {
    scopeKey: 'openai',
    autoPriority: 50,
    folderName: '90 Provider Validation',
    requestEnvVars: ['model=openai'],
    scopeRequirement: 'OPENAI_API_KEY',
    allRequirement: 'OPENAI_API_KEY',
  },
});
