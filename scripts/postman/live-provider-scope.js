const VALID_PROVIDER_SCOPES = new Set([
  'auto',
  'azure',
  'replicate',
  'all',
]);

/**
 * Normalizes a provider-scope string.
 *
 * @param {string|undefined|null} value
 * @param {{ label?: string, fallback?: string }} [options]
 * @returns {'auto'|'azure'|'replicate'|'all'}
 */
function normalizeProviderScope(
  value,
  { label = 'provider scope', fallback = 'auto' } = {},
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  const normalizedValue = value.trim().toLowerCase();
  if (!VALID_PROVIDER_SCOPES.has(normalizedValue)) {
    throw new Error(
      `${label} must be one of: ${Array.from(VALID_PROVIDER_SCOPES).join(', ')}`,
    );
  }

  return normalizedValue;
}

/**
 * Detects which live providers are configured from the supplied environment.
 *
 * @param {{
 *   replicateApiToken?: string|undefined,
 *   azureApiEndpoint?: string|undefined,
 *   azureSubscriptionKey?: string|undefined,
 * }} options
 * @returns {{ hasAzureProvider: boolean, hasReplicateProvider: boolean }}
 */
function detectAvailableProviders({
  replicateApiToken,
  azureApiEndpoint,
  azureSubscriptionKey,
}) {
  return {
    hasReplicateProvider: Boolean(replicateApiToken),
    hasAzureProvider: Boolean(azureApiEndpoint && azureSubscriptionKey),
  };
}

/**
 * Resolves the final live-provider scope to execute.
 *
 * `auto` prefers Azure when Azure credentials are configured, otherwise it
 * falls back to Replicate when that token exists.
 *
 * @param {{
 *   requestedScope?: string|undefined,
 *   configuredScope?: string|undefined,
 *   hasAzureProvider: boolean,
 *   hasReplicateProvider: boolean,
 * }} options
 * @returns {'azure'|'replicate'|'all'}
 */
function resolveProviderScope({
  requestedScope,
  configuredScope,
  hasAzureProvider,
  hasReplicateProvider,
}) {
  const normalizedRequestedScope = normalizeProviderScope(requestedScope, {
    label: 'requested provider_scope',
  });
  const normalizedConfiguredScope = normalizeProviderScope(configuredScope, {
    label: 'configured LIVE_PROVIDER_SCOPE',
  });
  const desiredScope = normalizedRequestedScope === 'auto'
    ? normalizedConfiguredScope
    : normalizedRequestedScope;

  if (desiredScope === 'auto') {
    if (hasAzureProvider) {
      return 'azure';
    }

    if (hasReplicateProvider) {
      return 'replicate';
    }

    throw new Error(
      'Live provider validation requires Azure credentials or REPLICATE_API_TOKEN',
    );
  }

  if (desiredScope === 'azure' && !hasAzureProvider) {
    throw new Error(
      'provider_scope=azure requires ACV_API_ENDPOINT and ACV_SUBSCRIPTION_KEY',
    );
  }

  if (desiredScope === 'replicate' && !hasReplicateProvider) {
    throw new Error('provider_scope=replicate requires REPLICATE_API_TOKEN');
  }

  if (desiredScope === 'all' && (!hasAzureProvider || !hasReplicateProvider)) {
    throw new Error(
      'provider_scope=all requires Azure credentials and REPLICATE_API_TOKEN',
    );
  }

  return desiredScope;
}

/**
 * Expands a resolved scope into provider booleans.
 *
 * @param {'azure'|'replicate'|'all'} scope
 * @returns {{ runAzure: boolean, runReplicate: boolean }}
 */
function getSelectedProviders(scope) {
  switch (scope) {
    case 'azure':
      return { runAzure: true, runReplicate: false };
    case 'replicate':
      return { runAzure: false, runReplicate: true };
    case 'all':
      return { runAzure: true, runReplicate: true };
    default:
      throw new Error(`Resolved live provider scope is invalid: ${scope}`);
  }
}

module.exports = {
  VALID_PROVIDER_SCOPES: Array.from(VALID_PROVIDER_SCOPES),
  detectAvailableProviders,
  getSelectedProviders,
  normalizeProviderScope,
  resolveProviderScope,
};
