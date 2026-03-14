const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'huggingface',
  displayName: 'Hugging Face Inference',
  startupHint: 'HF_API_KEY or HF_TOKEN to enable huggingface',
  apiKeyEnvNames: ['HF_API_KEY', 'HF_TOKEN'],
  baseUrlEnvName: 'HF_BASE_URL',
  defaultBaseUrl: 'https://router.huggingface.co/v1',
  modelEnvName: 'HF_MODEL',
  defaultModel: 'Qwen/Qwen3-VL-30B-A3B-Instruct:fastest',
  maxTokensEnvName: 'HF_MAX_TOKENS',
  promptEnvName: 'HF_PROMPT',
  providerValidation: {
    scopeKey: 'huggingface',
    autoPriority: 30,
    folderName: '90 Provider Validation',
    requestEnvVars: [
      'model=huggingface',
    ],
    scopeRequirement: 'HF_API_KEY or HF_TOKEN',
    allRequirement: 'HF_API_KEY or HF_TOKEN',
  },
});
