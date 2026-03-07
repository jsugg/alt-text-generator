/**
 * Decodes and normalizes an image source query parameter.
 *
 * @param {string} rawImageSource
 * @returns {string}
 */
const normalizeImageSource = (rawImageSource) => {
  let imageSource = decodeURIComponent(rawImageSource);

  if (imageSource.includes('?')) [imageSource] = imageSource.split('?');

  return imageSource;
};

module.exports = { normalizeImageSource };
