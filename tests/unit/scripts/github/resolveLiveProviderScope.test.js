const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendGitHubEnv,
  appendSummary,
  resolveScopeFromEnv,
} = require('../../../../scripts/github/resolve-live-provider-scope');

describe('scripts/github/resolve-live-provider-scope', () => {
  describe('resolveScopeFromEnv', () => {
    it('respects an explicit manual scope override', () => {
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'replicate',
        LIVE_PROVIDER_SCOPE: 'azure',
        REPLICATE_API_TOKEN: 'replicate-token',
        ACV_API_ENDPOINT: 'https://azure.example.com',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      })).toBe('replicate');
    });

    it('uses the configured environment scope when the manual input is auto', () => {
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'auto',
        LIVE_PROVIDER_SCOPE: 'all',
        REPLICATE_API_TOKEN: 'replicate-token',
        ACV_API_ENDPOINT: 'https://azure.example.com',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      })).toBe('all');
    });

    it('falls back to azure when auto is requested and both providers are configured', () => {
      expect(resolveScopeFromEnv({
        INPUT_PROVIDER_SCOPE: 'auto',
        REPLICATE_API_TOKEN: 'replicate-token',
        ACV_API_ENDPOINT: 'https://azure.example.com',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      })).toBe('azure');
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

      appendSummary(summaryFile, ['## Live Provider Validation', '', '- Resolved provider scope: azure']);

      expect(fs.readFileSync(summaryFile, 'utf8')).toBe(
        '## Live Provider Validation\n\n- Resolved provider scope: azure\n',
      );
    });
  });
});
