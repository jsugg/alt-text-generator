const DEFAULT_ALT_TEXT_PROMPT = require('../shared/defaultAltTextPrompt');

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const toPositiveIntegerOrFallback = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

/**
 * @param {unknown} value
 * @returns {boolean}
 */
const hasNonEmptyStringValue = (value) => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return Boolean(value);
};

/**
 * @param {Record<string, unknown>} [env]
 * @param {string[]} [keys]
 * @returns {boolean}
 */
const hasAnyEnvValue = (env = {}, keys = []) => keys.some((key) => Boolean(env[key]));

/**
 * @param {{ env?: Record<string, unknown>, apiKeyEnvNames?: string[], dependentEnvNames?: string[], errorMessage: string }} params
 * @returns {string[]}
 */
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
