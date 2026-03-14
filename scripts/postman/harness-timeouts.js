const DEFAULT_MAX_RESPONSE_TIME_MS = 1500;
const PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS = 120000;
const DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS = 10000;
const PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS = 180000;
const PROVIDER_VALIDATION_APP_REQUEST_TIMEOUT_MS = 90000;

/**
 * Resolves the Postman response-time assertion budget for the current mode.
 *
 * @param {{ providerValidationModeEnabled?: boolean }} [options]
 * @returns {number}
 */
function resolveMaxResponseTimeMs({ providerValidationModeEnabled = false } = {}) {
  return providerValidationModeEnabled
    ? PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS
    : DEFAULT_MAX_RESPONSE_TIME_MS;
}

/**
 * Resolves the Newman request timeout for the current harness mode.
 *
 * @param {{ providerValidationModeEnabled?: boolean }} [options]
 * @returns {number}
 */
function resolveNewmanTimeoutRequestMs({ providerValidationModeEnabled = false } = {}) {
  return providerValidationModeEnabled
    ? PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS
    : DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS;
}

module.exports = {
  DEFAULT_MAX_RESPONSE_TIME_MS,
  PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS,
  DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS,
  PROVIDER_VALIDATION_APP_REQUEST_TIMEOUT_MS,
  PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS,
  resolveMaxResponseTimeMs,
  resolveNewmanTimeoutRequestMs,
};
