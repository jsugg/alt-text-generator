const normalizeContentType = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  return value.split(';')[0].trim().toLowerCase();
};

/**
 * Downloads an image asset and normalizes the payload for multimodal providers.
 *
 * @param {object} params
 * @param {object} params.httpClient - axios-compatible HTTP client
 * @param {string} params.imageUrl
 * @param {object} [params.requestOptions]
 * @returns {Promise<{ buffer: Buffer, contentType: string | null, imageUrl: string }>}
 */
const fetchImageAsset = async ({
  httpClient,
  imageUrl,
  requestOptions = {},
}) => {
  const response = await httpClient.get(imageUrl, {
    timeout: requestOptions.timeout,
    maxRedirects: requestOptions.maxRedirects,
    maxContentLength: requestOptions.maxContentLength,
    maxBodyLength: requestOptions.maxContentLength,
    responseType: 'arraybuffer',
  });

  const buffer = Buffer.isBuffer(response.data)
    ? response.data
    : Buffer.from(response.data);

  return {
    buffer,
    contentType: normalizeContentType(response?.headers?.['content-type']),
    imageUrl,
  };
};

module.exports = {
  fetchImageAsset,
  normalizeContentType,
};
