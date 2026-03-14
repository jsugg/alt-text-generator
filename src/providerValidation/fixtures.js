const fs = require('fs');
const path = require('path');

const PROVIDER_VALIDATION_ASSET_DIRECTORY = path.resolve(
  __dirname,
  '../../provider-validation/public/assets',
);
const PROVIDER_VALIDATION_ASSET_FILENAMES = Object.freeze({
  'a.png': 'a.png',
  'b.png': 'b.png',
});
const PROVIDER_VALIDATION_ASSET_CACHE = new Map();
const PROVIDER_VALIDATION_PAGE_TITLE = 'Alt Text Provider Validation Fixture';

/**
 * @param {string} assetFilename
 * @returns {Buffer}
 */
function loadProviderValidationAsset(assetFilename) {
  if (!PROVIDER_VALIDATION_ASSET_CACHE.has(assetFilename)) {
    const assetPath = path.join(PROVIDER_VALIDATION_ASSET_DIRECTORY, assetFilename);
    PROVIDER_VALIDATION_ASSET_CACHE.set(assetFilename, fs.readFileSync(assetPath));
  }

  return PROVIDER_VALIDATION_ASSET_CACHE.get(assetFilename);
}

/**
 * @param {string} name
 * @returns {Buffer | null}
 */
function getProviderValidationAsset(name) {
  const assetFilename = PROVIDER_VALIDATION_ASSET_FILENAMES[name];

  if (!assetFilename) {
    return null;
  }

  return loadProviderValidationAsset(assetFilename);
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function buildProviderValidationPageHtml(baseUrl) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${PROVIDER_VALIDATION_PAGE_TITLE}</title>
  </head>
  <body>
    <h1>${PROVIDER_VALIDATION_PAGE_TITLE}</h1>
    <img src="/provider-validation/assets/a.png" alt="" />
    <img src="${baseUrl}/provider-validation/assets/b.png" alt="" />
    <img src="/provider-validation/assets/a.png" alt="" />
  </body>
</html>`;
}

module.exports = {
  buildProviderValidationPageHtml,
  getProviderValidationAsset,
  PROVIDER_VALIDATION_PAGE_TITLE,
};
