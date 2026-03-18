const DEFAULT_ALT_TEXT_PROMPT = require('../shared/defaultAltTextPrompt');

const toPositiveIntegerOrFallback = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const hasNonEmptyStringValue = (value) => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return Boolean(value);
};

const hasAnyEnvValue = (env = {}, keys = []) => keys.some((key) => Boolean(env[key]));

const validateApiKeyBackedProviderEnv = ({
  env = {},
  apiKeyEnvNames = [],
  dependentEnvNames = [],
  errorMessage,
}) => {
  const hasApiKey = hasAnyEnvValue(env, apiKeyEnvNames);

  if (hasApiKey || !hasAnyEnvValue(env, dependentEnvNames)) {
    return [];
  }

  return [errorMessage];
};

module.exports = {
  DEFAULT_ALT_TEXT_PROMPT,
  hasAnyEnvValue,
  hasNonEmptyStringValue,
  toPositiveIntegerOrFallback,
  validateApiKeyBackedProviderEnv,
};
