/**
 * @typedef {{
 *   config?: { url?: unknown },
 *   response?: { status?: number },
 *   code?: string,
 * }} SkippableSourceError
 */

/**
 * Returns whether an error is isolated to downloading or resolving one source image.
 *
 * @param {unknown} error
 * @param {string} providerBaseUrl
 * @returns {boolean}
 */
const isSkippableImageSourceError = (error, providerBaseUrl) => {
  const err = /** @type {SkippableSourceError | null | undefined} */ (error);
  const requestUrl = typeof err?.config?.url === 'string'
    ? err.config.url
    : null;
  const isProviderRequest = Boolean(
    requestUrl
    && providerBaseUrl
    && requestUrl.startsWith(providerBaseUrl),
  );

  if (isProviderRequest) {
    return false;
  }

  const status = err?.response?.status;
  const code = err?.code;

  return (
    status === 403
    || status === 404
    || status === 410
    || code === 'ECONNABORTED'
    || code === 'ENOTFOUND'
    || code === 'ETIMEDOUT'
  );
};

module.exports = {
  isSkippableImageSourceError,
};
