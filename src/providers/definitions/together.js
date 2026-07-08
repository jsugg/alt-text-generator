const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'together',
  displayName: 'Together AI Vision',
  startupHint: 'TOGETHER_API_KEY to enable together',
  apiKeyEnvNames: ['TOGETHER_API_KEY'],
  baseUrlEnvName: 'TOGETHER_BASE_URL',
  defaultBaseUrl: 'https://api.together.xyz/v1',
  modelEnvName: 'TOGETHER_MODEL',
  defaultModel: 'Qwen/Qwen3.5-9B',
  maxTokensEnvName: 'TOGETHER_MAX_TOKENS',
  promptEnvName: 'TOGETHER_PROMPT',
  // Qwen3.x models default to "thinking" mode. With a small max_tokens the model
  // spends the entire completion budget on reasoning and is cut off before it
  // emits any caption (finish_reason=length, content=""). Disable thinking so the
  // caption is produced directly in `content` and no reasoning tokens are billed.
  buildAdditionalConfig: () => ({
    requestParams: {
      chat_template_kwargs: { enable_thinking: false },
    },
  }),
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
