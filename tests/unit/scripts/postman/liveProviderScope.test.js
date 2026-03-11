const {
  detectAvailableProviders,
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
      })).toEqual({
        hasAzureProvider: true,
        hasReplicateProvider: true,
      });
    });

    it('requires both azure endpoint and credential', () => {
      expect(detectAvailableProviders({
        azureApiEndpoint: 'https://azure.example.com',
      })).toEqual({
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
        hasAzureProvider: true,
        hasReplicateProvider: true,
      })).toBe('azure');
    });

    it('uses the configured scope when the manual input is auto', () => {
      expect(resolveProviderScope({
        requestedScope: 'auto',
        configuredScope: 'all',
        hasAzureProvider: true,
        hasReplicateProvider: true,
      })).toBe('all');
    });

    it('uses replicate when auto is the only configured provider', () => {
      expect(resolveProviderScope({
        requestedScope: 'auto',
        configuredScope: 'auto',
        hasAzureProvider: false,
        hasReplicateProvider: true,
      })).toBe('replicate');
    });

    it('rejects azure scope without azure credentials', () => {
      expect(() => resolveProviderScope({
        requestedScope: 'azure',
        configuredScope: 'auto',
        hasAzureProvider: false,
        hasReplicateProvider: true,
      })).toThrow(
        'provider_scope=azure requires ACV_API_ENDPOINT and ACV_SUBSCRIPTION_KEY',
      );
    });

    it('rejects all scope when only one provider is configured', () => {
      expect(() => resolveProviderScope({
        requestedScope: 'all',
        configuredScope: 'auto',
        hasAzureProvider: true,
        hasReplicateProvider: false,
      })).toThrow(
        'provider_scope=all requires Azure credentials and REPLICATE_API_TOKEN',
      );
    });
  });

  describe('getSelectedProviders', () => {
    it('maps all to both providers', () => {
      expect(getSelectedProviders('all')).toEqual({
        runAzure: true,
        runReplicate: true,
      });
    });

    it('maps azure to azure only', () => {
      expect(getSelectedProviders('azure')).toEqual({
        runAzure: true,
        runReplicate: false,
      });
    });
  });
});
