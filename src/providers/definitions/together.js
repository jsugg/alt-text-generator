const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'together',
  displayName: 'Together AI Vision',
  startupHint: 'TOGETHER_API_KEY to enable together',
  apiKeyEnvNames: ['TOGETHER_API_KEY'],
  baseUrlEnvName: 'TOGETHER_BASE_URL',
  defaultBaseUrl: 'https://api.together.xyz/v1',
  modelEnvName: 'TOGETHER_MODEL',
  defaultModel: 'Qwen/Qwen3-VL-8B-Instruct',
  maxTokensEnvName: 'TOGETHER_MAX_TOKENS',
  promptEnvName: 'TOGETHER_PROMPT',
  providerValidation: {
    scopeKey: 'together',
    autoPriority: 60,
    folderName: '90 Provider Validation',
    requestEnvVars: [
      'model=together',
    ],
    scopeRequirement: 'TOGETHER_API_KEY',
    allRequirement: 'TOGETHER_API_KEY',
  },
});
