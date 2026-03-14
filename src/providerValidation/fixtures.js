const PROVIDER_VALIDATION_ASSETS = Object.freeze({
  'a.png': Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAqklEQVR4nOXOIQEAAAgDsKclLZ1OjAnE/JLZvsYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPKDxgMYDGg9oPIAdKkcSDtL9XfAAAAAASUVORK5CYII=',
    'base64',
  ),
  'b.png': Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlklEQVR4nO3QMQ0AMAzAsPJnMLQtDB/L4T/K7Jv92egArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0AwzPcmj9F9xNAAAAAElFTkSuQmCC',
    'base64',
  ),
});

const PROVIDER_VALIDATION_PAGE_TITLE = 'Alt Text Provider Validation Fixture';

/**
 * @param {string} name
 * @returns {Buffer | null}
 */
function getProviderValidationAsset(name) {
  return PROVIDER_VALIDATION_ASSETS[name] || null;
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
