const PROVIDER_VALIDATION_FIXTURE_TIMEOUT_MS = 15_000;

const PROVIDER_VALIDATION_FIXTURE_EXPECTATIONS = Object.freeze({
  providerValidationAzureImageUrl: 'image/',
  providerValidationAzurePageUrl: 'text/html',
  providerValidationImageUrl: 'image/',
  providerValidationPageUrl: 'text/html',
});

const ACCEPTABLE_HTML_CONTENT_TYPES = Object.freeze([
  'text/html',
  'text/plain',
]);

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeContentType(value) {
  return value.split(';', 1)[0].trim().toLowerCase();
}

/**
 * @param {Response} response
 * @param {string} key
 * @param {string} url
 * @param {string} expectedPrefix
 * @returns {Promise<void>}
 */
async function assertFixtureResponse(response, key, url, expectedPrefix) {
  if (!response.ok) {
    throw new Error(
      `${key} returned ${response.status} ${response.statusText} from ${url}`,
    );
  }

  const contentType = normalizeContentType(response.headers.get('content-type') || '');
  const acceptsHtmlFixture = expectedPrefix === 'text/html'
    && ACCEPTABLE_HTML_CONTENT_TYPES.includes(contentType);
  if (!acceptsHtmlFixture && !contentType.startsWith(expectedPrefix)) {
    const expectedDescription = expectedPrefix === 'text/html'
      ? 'text/html* or text/plain*'
      : `${expectedPrefix}*`;
    throw new Error(
      `${key} returned content-type "${contentType || 'unknown'}" from ${url}; `
        + `expected ${expectedDescription}`,
    );
  }

  if (expectedPrefix === 'text/html') {
    const body = await response.text();
    if (!body.includes('<img')) {
      throw new Error(`${key} from ${url} does not look like an HTML fixture page`);
    }
    return;
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  if (imageBuffer.length === 0) {
    throw new Error(`${key} from ${url} returned an empty image payload`);
  }
}

/**
 * Probes the public provider-validation fixtures before a live/provider run.
 *
 * @param {Record<string, string>} fixtureUrls
 * @param {{
 *   fetchFn?: typeof fetch,
 *   timeoutMs?: number,
 *   writeLog?: (message: string) => void,
 * }} [options]
 * @returns {Promise<void>}
 */
async function assertProviderValidationFixturesReachable(
  fixtureUrls,
  {
    fetchFn = fetch,
    timeoutMs = PROVIDER_VALIDATION_FIXTURE_TIMEOUT_MS,
    writeLog = (message) => process.stdout.write(`${message}\n`),
  } = {},
) {
  const entries = Object.entries(PROVIDER_VALIDATION_FIXTURE_EXPECTATIONS)
    .map(([key, expectedPrefix]) => ({
      key,
      expectedPrefix,
      url: fixtureUrls[key],
    }))
    .filter((entry, index, collection) => collection.findIndex((candidate) => (
      candidate.url === entry.url && candidate.expectedPrefix === entry.expectedPrefix
    )) === index);

  await entries.reduce(
    (probePromise, entry) => probePromise.then(async () => {
      if (!entry.url) {
        throw new Error(`${entry.key} is required for provider validation`);
      }

      const response = await fetchFn(entry.url, {
        headers: {
          Accept: entry.expectedPrefix === 'text/html' ? 'text/html' : 'image/png',
        },
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });

      await assertFixtureResponse(
        response,
        entry.key,
        entry.url,
        entry.expectedPrefix,
      );
    }),
    Promise.resolve(),
  );

  writeLog('[fixtures] provider-validation public fixtures are reachable');
}

module.exports = {
  PROVIDER_VALIDATION_FIXTURE_TIMEOUT_MS,
  assertProviderValidationFixturesReachable,
  normalizeContentType,
};
