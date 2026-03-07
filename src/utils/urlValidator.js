const { URL } = require('url');

/**
 * Returns true if the string is a valid, parseable URL.
 * @param {string} url
 * @returns {boolean}
 */
const isValidUrl = (url) => {
  try {
    return Boolean(new URL(url));
  } catch {
    return false;
  }
};

module.exports = { isValidUrl };
