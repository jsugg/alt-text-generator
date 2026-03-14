const {
  getAvailableProviderValidationScopes,
  getProviderValidationByScope,
  getProviderValidationProviders,
} = require('../../config/providerCatalog');

const getSortedProviderValidationProviders = () => getProviderValidationProviders()
  .sort(
    (left, right) => left.providerValidation.autoPriority - right.providerValidation.autoPriority,
  );

const VALID_PROVIDER_SCOPES = new Set([
  'auto',
  ...getSortedProviderValidationProviders()
    .map((provider) => provider.providerValidation.scopeKey),
  'all',
]);
const LOW_COST_PROVIDER_VALIDATION_SCOPES = Object.freeze([
  'huggingface',
  'openai',
]);

const resolveConfiguredProviderScopes = ({
  configuredProviderScopes,
  hasAzureProvider,
  hasReplicateProvider,
} = {}) => {
  if (Array.isArray(configuredProviderScopes)) {
    return configuredProviderScopes;
  }

  return [
    ...(hasAzureProvider ? ['azure'] : []),
    ...(hasReplicateProvider ? ['replicate'] : []),
  ];
};

const buildAllRequirementMessage = () => {
  const requirements = getSortedProviderValidationProviders()
    .map((provider) => provider.providerValidation.allRequirement);

  if (requirements.length === 0) {
    return 'provider validation credentials';
  }

  if (requirements.length === 1) {
    return requirements[0];
  }

  if (requirements.length === 2) {
    return `${requirements[0]} and ${requirements[1]}`;
  }

  return requirements.join(', ');
};

const resolveSelectedProviderScopes = (scope, configuredProviderScopes = null) => {
  if (scope !== 'all') {
    return [scope];
  }

  if (Array.isArray(configuredProviderScopes) && configuredProviderScopes.length > 0) {
    const configuredProviderScopeSet = new Set(configuredProviderScopes);

    return getSortedProviderValidationProviders()
      .map((provider) => provider.providerValidation.scopeKey)
      .filter((scopeKey) => configuredProviderScopeSet.has(scopeKey));
  }

  return getAvailableProviderValidationScopes();
};

/**
 * Normalizes a provider-scope string.
 *
 * @param {string|undefined|null} value
 * @param {{ label?: string, fallback?: string }} [options]
 * @returns {'auto'|'azure'|'replicate'|'huggingface'|'openai'|'openrouter'|'together'|'all'}
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
 * Detects which provider-validation targets are configured from the supplied environment.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   configuredProviderScopes: string[],
 *   hasAzureProvider: boolean,
 *   hasReplicateProvider: boolean,
 * }}
 */
function detectAvailableProviders(env = process.env, { allowedProviderScopes = null } = {}) {
  const allowedProviderScopeSet = Array.isArray(allowedProviderScopes)
    ? new Set(allowedProviderScopes)
    : null;
  const configuredProviderScopes = getProviderValidationProviders()
    .filter((provider) => (
      provider.isConfiguredInEnv(env)
      && (
        allowedProviderScopeSet === null
        || allowedProviderScopeSet.has(provider.providerValidation.scopeKey)
      )
    ))
    .map((provider) => provider.providerValidation.scopeKey);

  return {
    configuredProviderScopes,
    hasAzureProvider: configuredProviderScopes.includes('azure'),
    hasReplicateProvider: configuredProviderScopes.includes('replicate'),
  };
}

/**
 * Resolves the final provider-validation scope to execute.
 *
 * `auto` prefers the configured provider with the lowest `autoPriority`.
 *
 * @param {{
 *   requestedScope?: string|undefined,
 *   configuredScope?: string|undefined,
 *   configuredProviderScopes?: string[]|undefined,
 *   hasAzureProvider?: boolean|undefined,
 *   hasReplicateProvider?: boolean|undefined,
 * }} options
 * @returns {'azure'|'replicate'|'huggingface'|'openai'|'openrouter'|'together'|'all'}
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
    const autoProvider = getSortedProviderValidationProviders()
      .filter((provider) => configuredProviderScopeSet.has(provider.providerValidation.scopeKey))
      .at(0);

    if (autoProvider) {
      return autoProvider.providerValidation.scopeKey;
    }

    throw new Error(
      `Provider validation requires ${buildAllRequirementMessage()}`,
    );
  }

  if (desiredScope === 'all') {
    if (resolvedProviderScopes.length === 0) {
      throw new Error(
        `provider validation requires ${buildAllRequirementMessage()}`,
      );
    }

    return desiredScope;
  }

  if (desiredScope !== 'all' && !configuredProviderScopeSet.has(desiredScope)) {
    const provider = getProviderValidationByScope(desiredScope);

    throw new Error(
      `provider_scope=${desiredScope} requires ${provider.providerValidation.scopeRequirement}`,
    );
  }

  return desiredScope;
}

/**
 * Expands a resolved scope into provider booleans.
 *
 * @param {'azure'|'replicate'|'huggingface'|'openai'|'openrouter'|'together'|'all'} scope
 * @returns {{
 *   selectedProviderScopes: string[],
 *   runAzure: boolean,
 *   runReplicate: boolean,
 * }}
 */
function getSelectedProviders(scope, { configuredProviderScopes } = {}) {
  const selectedProviderScopes = resolveSelectedProviderScopes(scope, configuredProviderScopes);

  selectedProviderScopes.forEach((selectedScope) => {
    if (!getProviderValidationByScope(selectedScope)) {
      throw new Error(`Resolved provider validation scope is invalid: ${scope}`);
    }
  });

  return {
    selectedProviderScopes,
    runAzure: selectedProviderScopes.includes('azure'),
    runReplicate: selectedProviderScopes.includes('replicate'),
  };
}

/**
 * Builds provider-validation execution plans for the resolved provider scope.
 *
 * @param {'azure'|'replicate'|'huggingface'|'openai'|'openrouter'|'together'|'all'} scope
 * @param {{ mode?: 'live'|'provider-integration' }} [options]
 * @returns {{ folderName: string, envVars: string[], scopeKey: string }[]}
 */
function getSelectedProviderPlans(scope, {
  configuredProviderScopes,
  mode = 'live',
} = {}) {
  const { selectedProviderScopes } = getSelectedProviders(scope, { configuredProviderScopes });

  return selectedProviderScopes.map((selectedScope) => {
    const provider = getProviderValidationByScope(selectedScope);

    if (!provider) {
      throw new Error(`Resolved provider validation scope is invalid: ${scope}`);
    }

    const envVars = [
      ...(provider.providerValidation.requestEnvVars || []),
      ...(mode === 'provider-integration'
        ? provider.providerValidation.providerIntegrationEnvVars || []
        : []),
    ];

    return {
      folderName: provider.providerValidation.folderName,
      envVars,
      scopeKey: selectedScope,
    };
  });
}

function getSelectedProviderFolders(scope, options) {
  return Array.from(new Set(
    getSelectedProviderPlans(scope, options).map((providerPlan) => providerPlan.folderName),
  ));
}

module.exports = {
  LOW_COST_PROVIDER_VALIDATION_SCOPES,
  VALID_PROVIDER_SCOPES: Array.from(VALID_PROVIDER_SCOPES),
  detectAvailableProviders,
  getSelectedProviderFolders,
  getSelectedProviderPlans,
  getSelectedProviders,
  normalizeProviderScope,
  resolveProviderScope,
};
