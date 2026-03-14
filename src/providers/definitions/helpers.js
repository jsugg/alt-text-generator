const DEFAULT_ALT_TEXT_PROMPT = require('../shared/defaultAltTextPrompt');

const toPositiveIntegerOrFallback = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const hasAnyEnvValue = (env = {}, keys = []) => keys.some((key) => Boolean(env[key]));

const toOptionalBooleanString = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return undefined;
};

const isExplicitlyDisabled = (envName, env = {}) => toOptionalBooleanString(env[envName]) === false;

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
  isExplicitlyDisabled,
  toOptionalBooleanString,
  toPositiveIntegerOrFallback,
  validateApiKeyBackedProviderEnv,
};
