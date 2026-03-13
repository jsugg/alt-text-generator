const {
  getAvailableLiveProviderScopes,
  getLiveProviderByScope,
  getLiveValidationProviders,
} = require('../../config/providerCatalog');

const getSortedLiveValidationProviders = () => getLiveValidationProviders()
  .sort((left, right) => left.liveValidation.autoPriority - right.liveValidation.autoPriority);

const VALID_PROVIDER_SCOPES = new Set([
  'auto',
  ...getSortedLiveValidationProviders()
    .map((provider) => provider.liveValidation.scopeKey),
  'all',
]);

const resolveConfiguredProviderScopes = ({
  configuredProviderScopes,
  hasAzureProvider,
  hasReplicateProvider,
} = {}) => {
  if (Array.isArray(configuredProviderScopes)) {
    return configuredProviderScopes;
  }

  return getLiveValidationProviders()
    .filter((provider) => (
      (provider.liveValidation.scopeKey === 'azure' && hasAzureProvider)
      || (provider.liveValidation.scopeKey === 'replicate' && hasReplicateProvider)
    ))
    .map((provider) => provider.liveValidation.scopeKey);
};

const buildAllRequirementMessage = () => {
  const requirements = getSortedLiveValidationProviders()
    .map((provider) => provider.liveValidation.allRequirement);

  if (requirements.length === 0) {
    return 'live provider credentials';
  }

  if (requirements.length === 1) {
    return requirements[0];
  }

  if (requirements.length === 2) {
    return `${requirements[0]} and ${requirements[1]}`;
  }

  return requirements.join(', ');
};

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
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   configuredProviderScopes: string[],
 *   hasAzureProvider: boolean,
 *   hasReplicateProvider: boolean,
 * }}
 */
function detectAvailableProviders(env = process.env) {
  const configuredProviderScopes = getLiveValidationProviders()
    .filter((provider) => provider.isConfiguredInEnv(env))
    .map((provider) => provider.liveValidation.scopeKey);

  return {
    configuredProviderScopes,
    hasAzureProvider: configuredProviderScopes.includes('azure'),
    hasReplicateProvider: configuredProviderScopes.includes('replicate'),
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
 *   configuredProviderScopes?: string[]|undefined,
 *   hasAzureProvider?: boolean|undefined,
 *   hasReplicateProvider?: boolean|undefined,
 * }} options
 * @returns {'azure'|'replicate'|'all'}
 */
function resolveProviderScope({
  requestedScope,
  configuredScope,
  configuredProviderScopes,
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
  const resolvedProviderScopes = resolveConfiguredProviderScopes({
    configuredProviderScopes,
    hasAzureProvider,
    hasReplicateProvider,
  });
  const configuredProviderScopeSet = new Set(resolvedProviderScopes);

  if (desiredScope === 'auto') {
    const autoProvider = getSortedLiveValidationProviders()
      .filter((provider) => configuredProviderScopeSet.has(provider.liveValidation.scopeKey))
      .at(0);

    if (autoProvider) {
      return autoProvider.liveValidation.scopeKey;
    }

    throw new Error(
      `Live provider validation requires ${buildAllRequirementMessage()}`,
    );
  }

  if (
    desiredScope === 'all'
    && resolvedProviderScopes.length !== getAvailableLiveProviderScopes().length
  ) {
    throw new Error(
      `provider_scope=all requires ${buildAllRequirementMessage()}`,
    );
  }

  if (desiredScope !== 'all' && !configuredProviderScopeSet.has(desiredScope)) {
    const provider = getLiveProviderByScope(desiredScope);

    throw new Error(
      `provider_scope=${desiredScope} requires ${provider.liveValidation.scopeRequirement}`,
    );
  }

  return desiredScope;
}

/**
 * Expands a resolved scope into provider booleans.
 *
 * @param {'azure'|'replicate'|'all'} scope
 * @returns {{
 *   selectedProviderScopes: string[],
 *   runAzure: boolean,
 *   runReplicate: boolean,
 * }}
 */
function getSelectedProviders(scope) {
  const selectedProviderScopes = scope === 'all'
    ? getAvailableLiveProviderScopes()
    : [scope];

  selectedProviderScopes.forEach((selectedScope) => {
    if (!getLiveProviderByScope(selectedScope)) {
      throw new Error(`Resolved live provider scope is invalid: ${scope}`);
    }
  });

  return {
    selectedProviderScopes,
    runAzure: selectedProviderScopes.includes('azure'),
    runReplicate: selectedProviderScopes.includes('replicate'),
  };
}

function getSelectedProviderFolders(scope) {
  const { selectedProviderScopes } = getSelectedProviders(scope);

  return selectedProviderScopes.map((selectedScope) => {
    const provider = getLiveProviderByScope(selectedScope);
    return provider.liveValidation.folderName;
  });
}

module.exports = {
  VALID_PROVIDER_SCOPES: Array.from(VALID_PROVIDER_SCOPES),
  detectAvailableProviders,
  getSelectedProviderFolders,
  getSelectedProviders,
  normalizeProviderScope,
  resolveProviderScope,
};
