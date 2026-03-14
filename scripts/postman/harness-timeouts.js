const DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS = 10000;
const PROVIDER_INTEGRATION_NEWMAN_TIMEOUT_REQUEST_MS = 45000;

/**
 * Resolves the Newman request timeout for the current harness mode.
 *
 * @param {{ providerIntegrationModeEnabled?: boolean }} [options]
 * @returns {number}
 */
function resolveNewmanTimeoutRequestMs({ providerIntegrationModeEnabled = false } = {}) {
  return providerIntegrationModeEnabled
    ? PROVIDER_INTEGRATION_NEWMAN_TIMEOUT_REQUEST_MS
    : DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS;
}

module.exports = {
  DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS,
  PROVIDER_INTEGRATION_NEWMAN_TIMEOUT_REQUEST_MS,
  resolveNewmanTimeoutRequestMs,
};
