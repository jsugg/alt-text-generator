const SAFE_RESPONSE_HEADER_NAMES = [
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
];

const MAX_BODY_PREVIEW_LENGTH = 512;

const truncate = (value) => {
  if (typeof value !== 'string' || value.length <= MAX_BODY_PREVIEW_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_BODY_PREVIEW_LENGTH)}...`;
};

const getHeaderValue = (headers, headerName) => {
  if (!headers) {
    return undefined;
  }

  if (typeof headers.get === 'function') {
    return headers.get(headerName) ?? undefined;
  }

  if (typeof headers !== 'object') {
    return undefined;
  }

  const matchingKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === headerName.toLowerCase(),
  );

  if (!matchingKey) {
    return undefined;
  }

  const value = headers[matchingKey];

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  return value;
};

const buildRequestUrl = (config = {}) => {
  const { baseURL, url } = config;

  if (!url) {
    return baseURL;
  }

  if (!baseURL) {
    return url;
  }

  try {
    return new URL(url, baseURL).toString();
  } catch {
    return url || baseURL;
  }
};

const serializeBodyPreview = (body) => {
  if (body == null) {
    return undefined;
  }

  if (typeof body === 'string') {
    return truncate(body);
  }

  try {
    return truncate(JSON.stringify(body));
  } catch {
    return truncate(String(body));
  }
};

const summarizeRequest = (error) => {
  const request = error?.request;
  const config = error?.config;
  const method = request?.method ?? config?.method;
  const url = request?.url ?? buildRequestUrl(config);

  if (!method && !url) {
    return undefined;
  }

  return {
    ...(method ? { method: String(method).toUpperCase() } : {}),
    ...(url ? { url } : {}),
  };
};

const summarizeResponseHeaders = (response) => {
  const headers = SAFE_RESPONSE_HEADER_NAMES.reduce((accumulator, headerName) => {
    const value = getHeaderValue(response?.headers, headerName);

    if (value) {
      accumulator[headerName] = value;
    }

    return accumulator;
  }, {});

  return Object.keys(headers).length > 0 ? headers : undefined;
};

const summarizeResponse = (error) => {
  const response = error?.response;

  if (!response) {
    return undefined;
  }

  const headers = summarizeResponseHeaders(response);
  const bodyPreview = serializeBodyPreview(response.data);

  return {
    ...(typeof response.status === 'number' ? { status: response.status } : {}),
    ...(response.statusText ? { statusText: response.statusText } : {}),
    ...(headers ? { headers } : {}),
    ...(bodyPreview ? { bodyPreview } : {}),
  };
};

/**
 * Creates a safe, compact summary of an upstream HTTP/client error.
 *
 * @param {unknown} error
 * @returns {object | undefined}
 */
const getUpstreamErrorSummary = (error) => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const request = summarizeRequest(error);
  const response = summarizeResponse(error);
  const code = typeof error.code === 'string' ? error.code : undefined;

  if (!request && !response && !code) {
    return undefined;
  }

  return {
    ...(code ? { code } : {}),
    ...(request ? { request } : {}),
    ...(response ? { response } : {}),
  };
};

module.exports = { getUpstreamErrorSummary };
