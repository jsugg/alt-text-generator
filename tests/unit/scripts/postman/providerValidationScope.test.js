const {
  LOW_COST_PROVIDER_VALIDATION_SCOPES,
  detectAvailableProviders,
  getSelectedProviderFolders,
  getSelectedProviderPlans,
  getSelectedProviders,
  normalizeProviderScope,
  resolveProviderScope,
} = require('../../../../scripts/postman/provider-validation-scope');

describe('Unit | Scripts | Postman | Provider Validation Scope', () => {
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
        'provider scope must be one of: auto, azure, replicate, huggingface, openrouter, openai, all',
      );
    });
  });

  describe('detectAvailableProviders', () => {
    it('can restrict detection to an allowed provider subset', () => {
      expect(detectAvailableProviders({
        HF_API_KEY: 'hf-key',
        OPENAI_API_KEY: 'openai-key',
        OPENROUTER_API_KEY: 'openrouter-key',
      }, {
        allowedProviderScopes: LOW_COST_PROVIDER_VALIDATION_SCOPES,
      })).toEqual({
        configuredProviderScopes: ['huggingface', 'openai'],
        hasAzureProvider: false,
        hasReplicateProvider: false,
      });
    });

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

    it('treats a Replicate token as sufficient for the configured scope list', () => {
      expect(detectAvailableProviders({
        REPLICATE_API_TOKEN: 'replicate-token',
        OPENAI_API_KEY: 'openai-key',
      })).toEqual({
        configuredProviderScopes: ['replicate', 'openai'],
        hasAzureProvider: false,
        hasReplicateProvider: true,
      });
    });

    it('detects api-key-backed multimodal providers', () => {
      expect(detectAvailableProviders({
        HF_API_KEY: 'hf-key',
        OPENAI_API_KEY: 'openai-key',
        OPENROUTER_API_KEY: 'openrouter-key',
      })).toEqual({
        configuredProviderScopes: ['huggingface', 'openai', 'openrouter'],
        hasAzureProvider: false,
        hasReplicateProvider: false,
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
        configuredProviderScopes: ['replicate', 'azure', 'huggingface', 'openai', 'openrouter'],
      })).toBe('all');
    });

    it('uses replicate when auto is the only configured provider', () => {
      expect(resolveProviderScope({
        requestedScope: 'auto',
        configuredScope: 'auto',
        configuredProviderScopes: ['replicate'],
      })).toBe('replicate');
    });

    it('falls back to huggingface before openai and openrouter in auto mode', () => {
      expect(resolveProviderScope({
        requestedScope: 'auto',
        configuredScope: 'auto',
        configuredProviderScopes: ['openrouter', 'openai', 'huggingface'],
      })).toBe('huggingface');
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

    it('expands all to the configured providers only', () => {
      expect(resolveProviderScope({
        requestedScope: 'all',
        configuredScope: 'auto',
        configuredProviderScopes: ['azure'],
      })).toBe('all');
    });

    it('rejects all scope when no provider is configured', () => {
      expect(() => resolveProviderScope({
        requestedScope: 'all',
        configuredScope: 'auto',
        configuredProviderScopes: [],
      })).toThrow(
        'provider validation requires Azure credentials, REPLICATE_API_TOKEN, HF_API_KEY or HF_TOKEN, OPENROUTER_API_KEY, OPENAI_API_KEY',
      );
    });
  });

  describe('getSelectedProviders', () => {
    it('maps all to the configured providers', () => {
      expect(getSelectedProviders('all', {
        configuredProviderScopes: ['azure', 'openai'],
      })).toEqual({
        selectedProviderScopes: ['azure', 'openai'],
        runAzure: true,
        runReplicate: false,
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

  describe('getSelectedProviderPlans', () => {
    it('maps generic providers to the shared neutral folder with production env vars', () => {
      expect(getSelectedProviderPlans('huggingface')).toEqual([
        {
          folderName: '90 Provider Validation',
          envVars: [
            'model=huggingface',
          ],
          scopeKey: 'huggingface',
        },
      ]);
    });

    it('keeps provider-specific request env vars in provider-integration mode', () => {
      expect(getSelectedProviderPlans('openai', { mode: 'provider-integration' })).toEqual([
        {
          folderName: '90 Provider Validation',
          envVars: [
            'model=openai',
          ],
          scopeKey: 'openai',
        },
      ]);
    });

    it('expands all using only configured provider plans', () => {
      expect(getSelectedProviderPlans('all', {
        configuredProviderScopes: ['azure', 'openrouter'],
      })).toEqual([
        {
          folderName: '91 Azure Provider Validation',
          envVars: [],
          scopeKey: 'azure',
        },
        {
          folderName: '90 Provider Validation',
          envVars: [
            'model=openrouter',
          ],
          scopeKey: 'openrouter',
        },
      ]);
    });
  });

  describe('getSelectedProviderFolders', () => {
    it('maps the all scope to the configured live provider folders', () => {
      expect(getSelectedProviderFolders('all', {
        configuredProviderScopes: ['azure', 'openrouter'],
      })).toEqual([
        '91 Azure Provider Validation',
        '90 Provider Validation',
      ]);
    });
  });
});
