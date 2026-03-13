const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'together',
  displayName: 'Together AI Vision',
  startupHint: 'TOGETHER_API_KEY to enable together',
  apiKeyEnvNames: ['TOGETHER_API_KEY'],
  baseUrlEnvName: 'TOGETHER_BASE_URL',
  defaultBaseUrl: 'https://api.together.xyz/v1',
  modelEnvName: 'TOGETHER_MODEL',
  defaultModel: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
  maxTokensEnvName: 'TOGETHER_MAX_TOKENS',
  promptEnvName: 'TOGETHER_PROMPT',
});
