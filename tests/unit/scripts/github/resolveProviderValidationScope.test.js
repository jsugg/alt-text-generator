const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendGitHubEnv,
  appendSummary,
  resolveScopeFromEnv,
} = require('../../../../scripts/github/resolve-provider-validation-scope');

const NO_PROVIDER_OVERRIDES_FILE = path.join(
  os.tmpdir(),
  'alt-text-generator-provider-overrides-missing.yaml',
);

describe('Unit | Scripts | GitHub | Resolve Provider Validation Scope', () => {
  describe('resolveScopeFromEnv', () => {
    it('respects an explicit manual scope override', () => {
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'replicate',
        LIVE_PROVIDER_SCOPE: 'azure',
        PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
        REPLICATE_API_TOKEN: 'replicate-token',
        ACV_API_ENDPOINT: 'https://azure.example.com',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      })).toBe('replicate');
    });

    it('uses the configured environment scope when the manual input is auto', () => {
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'auto',
        LIVE_PROVIDER_SCOPE: 'all',
        PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
        REPLICATE_API_TOKEN: 'replicate-token',
        ACV_API_ENDPOINT: 'https://azure.example.com',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
        HF_API_KEY: 'hf-key',
        OPENAI_API_KEY: 'openai-key',
        OPENROUTER_API_KEY: 'openrouter-key',
        TOGETHER_API_KEY: 'together-key',
      })).toBe('all');
    });

    it('treats a Replicate token as a configured provider when resolving auto', () => {
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'auto',
        LIVE_PROVIDER_SCOPE: 'auto',
        PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
        REPLICATE_API_TOKEN: 'replicate-token',
        OPENAI_API_KEY: 'openai-key',
      })).toBe('replicate');
    });

    it('falls back to azure when auto is requested and both providers are configured', () => {
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'auto',
        PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
        REPLICATE_API_TOKEN: 'replicate-token',
        ACV_API_ENDPOINT: 'https://azure.example.com',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      })).toBe('azure');
    });

    it('resolves api-key multimodal providers when they are explicitly requested', () => {
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'openai',
        PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
        OPENAI_API_KEY: 'openai-key',
      })).toBe('openai');
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'openrouter',
        PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
        OPENROUTER_API_KEY: 'openrouter-key',
      })).toBe('openrouter');
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'huggingface',
        PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
        HF_API_KEY: 'hf-key',
      })).toBe('huggingface');
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'together',
        PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
        TOGETHER_API_KEY: 'together-key',
      })).toBe('together');
    });
  });

  describe('appendGitHubEnv', () => {
    it('writes key/value pairs to the provided file', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-scope-env-'));
      const envFile = path.join(tempDir, 'github-env.txt');

      appendGitHubEnv(envFile, 'LIVE_PROVIDER_SCOPE', 'azure');

      expect(fs.readFileSync(envFile, 'utf8')).toBe('LIVE_PROVIDER_SCOPE=azure\n');
    });
  });

  describe('appendSummary', () => {
    it('writes markdown lines to the summary file', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-scope-summary-'));
      const summaryFile = path.join(tempDir, 'summary.md');

      appendSummary(summaryFile, ['## Provider Validation', '', '- Resolved provider scope: azure']);

      expect(fs.readFileSync(summaryFile, 'utf8')).toBe(
        '## Provider Validation\n\n- Resolved provider scope: azure\n',
      );
    });
  });
});
