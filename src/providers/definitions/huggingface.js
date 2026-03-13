const { buildOpenAiCompatibleProvider } = require('./buildOpenAiCompatibleProvider');

module.exports = buildOpenAiCompatibleProvider({
  key: 'huggingface',
  displayName: 'Hugging Face Inference',
  startupHint: 'HF_API_KEY or HF_TOKEN to enable huggingface',
  apiKeyEnvNames: ['HF_API_KEY', 'HF_TOKEN'],
  baseUrlEnvName: 'HF_BASE_URL',
  defaultBaseUrl: 'https://router.huggingface.co/v1',
  modelEnvName: 'HF_MODEL',
  defaultModel: 'Qwen/Qwen2.5-VL-7B-Instruct:cheapest',
  maxTokensEnvName: 'HF_MAX_TOKENS',
  promptEnvName: 'HF_PROMPT',
});
