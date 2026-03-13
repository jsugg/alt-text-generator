const {
  detectAvailableProviders,
  getSelectedProviderFolders,
  getSelectedProviders,
  normalizeProviderScope,
  resolveProviderScope,
} = require('../../../../scripts/postman/live-provider-scope');

describe('Unit | Scripts | Postman | Live Provider Scope', () => {
  describe('normalizeProviderScope', () => {
    it('falls back to auto when the value is empty', () => {
      expect(normalizeProviderScope(undefined)).toBe('auto');
      expect(normalizeProviderScope('')).toBe('auto');
    });

    it('normalizes case and whitespace', () => {
      expect(normalizeProviderScope(' Azure ')).toBe('azure');
    });

    it('rejects unsupported scope values', () => {
      expect(() => normalizeProviderScope('both')).toThrow(
        'provider scope must be one of: auto, azure, replicate, all',
      );
    });
  });

  describe('detectAvailableProviders', () => {
    it('detects replicate and azure independently', () => {
      expect(detectAvailableProviders({
        replicateApiToken: 'replicate-token',
        azureApiEndpoint: 'https://azure.example.com',
        azureSubscriptionKey: 'azure-key',
        REPLICATE_API_TOKEN: 'replicate-token',
        ACV_API_ENDPOINT: 'https://azure.example.com',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      })).toEqual({
        configuredProviderScopes: ['replicate', 'azure'],
        hasAzureProvider: true,
        hasReplicateProvider: true,
      });
    });

    it('requires both azure endpoint and credential', () => {
      expect(detectAvailableProviders({
        ACV_API_ENDPOINT: 'https://azure.example.com',
      })).toEqual({
        configuredProviderScopes: [],
        hasAzureProvider: false,
        hasReplicateProvider: false,
      });
    });
  });

  describe('resolveProviderScope', () => {
    it('prefers azure in auto mode when both providers are available', () => {
      expect(resolveProviderScope({
        requestedScope: 'auto',
        configuredScope: 'auto',
        configuredProviderScopes: ['replicate', 'azure'],
      })).toBe('azure');
    });

    it('uses the configured scope when the manual input is auto', () => {
      expect(resolveProviderScope({
        requestedScope: 'auto',
        configuredScope: 'all',
        configuredProviderScopes: ['replicate', 'azure'],
      })).toBe('all');
    });

    it('uses replicate when auto is the only configured provider', () => {
      expect(resolveProviderScope({
        requestedScope: 'auto',
        configuredScope: 'auto',
        configuredProviderScopes: ['replicate'],
      })).toBe('replicate');
    });

    it('rejects azure scope without azure credentials', () => {
      expect(() => resolveProviderScope({
        requestedScope: 'azure',
        configuredScope: 'auto',
        configuredProviderScopes: ['replicate'],
      })).toThrow(
        'provider_scope=azure requires ACV_API_ENDPOINT and ACV_SUBSCRIPTION_KEY',
      );
    });

    it('rejects all scope when only one provider is configured', () => {
      expect(() => resolveProviderScope({
        requestedScope: 'all',
        configuredScope: 'auto',
        configuredProviderScopes: ['azure'],
      })).toThrow(
        'provider_scope=all requires Azure credentials and REPLICATE_API_TOKEN',
      );
    });
  });

  describe('getSelectedProviders', () => {
    it('maps all to both providers', () => {
      expect(getSelectedProviders('all')).toEqual({
        selectedProviderScopes: ['replicate', 'azure'],
        runAzure: true,
        runReplicate: true,
      });
    });

    it('maps azure to azure only', () => {
      expect(getSelectedProviders('azure')).toEqual({
        selectedProviderScopes: ['azure'],
        runAzure: true,
        runReplicate: false,
      });
    });
  });

  describe('getSelectedProviderFolders', () => {
    it('maps the all scope to every live provider folder', () => {
      expect(getSelectedProviderFolders('all')).toEqual([
        '90 Live Provider Validation',
        '91 Live Azure Validation',
      ]);
    });
  });
});
