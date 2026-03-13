/**
 * Returns whether an error is isolated to downloading or resolving one source image.
 *
 * @param {unknown} error
 * @param {string} providerBaseUrl
 * @returns {boolean}
 */
const isSkippableImageSourceError = (error, providerBaseUrl) => {
  const requestUrl = typeof error?.config?.url === 'string'
    ? error.config.url
    : null;
  const isProviderRequest = Boolean(
    requestUrl
    && providerBaseUrl
    && requestUrl.startsWith(providerBaseUrl),
  );

  if (isProviderRequest) {
    return false;
  }

  const status = error?.response?.status;
  const code = error?.code;

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
