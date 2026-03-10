#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');

const DEFAULT_BASE_URL = 'https://wcag.qcraft.com.br';
const DEFAULT_TIMEOUT_MS = 30_000;
const EXTENDED_TIMEOUT_MS = 45_000;

/**
 * Parses command-line arguments into a key/value object.
 *
 * @param {string[]} argv
 * @returns {{
 *   baseUrl: string,
 *   event: string,
 *   summaryFile: string|null,
 * }}
 */
function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    event: 'unknown',
    summaryFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const separatorIndex = token.indexOf('=');
    const key = separatorIndex >= 0 ? token.slice(2, separatorIndex) : token.slice(2);
    const rawValue = separatorIndex >= 0 ? token.slice(separatorIndex + 1) : argv[index + 1];

    if (separatorIndex < 0) {
      index += 1;
    }

    if (rawValue === undefined) {
      throw new Error(`Missing value for --${key}`);
    }

    switch (key) {
      case 'base-url':
        args.baseUrl = rawValue;
        break;
      case 'event':
        args.event = rawValue;
        break;
      case 'summary-file':
        args.summaryFile = rawValue;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  return args;
}

/**
 * Normalizes and validates a base URL.
 *
 * @param {string} baseUrl
 * @returns {string}
 */
function normalizeBaseUrl(baseUrl) {
  const normalized = new URL(baseUrl).toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

/**
 * Appends markdown to a GitHub Actions summary file.
 *
 * @param {string|null} summaryFile
 * @param {string[]} lines
 */
function appendSummary(summaryFile, lines) {
  if (!summaryFile) {
    return;
  }

  fs.appendFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Sleeps for the given amount of time.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Returns a compact preview of a response body for error messages.
 *
 * @param {string} body
 * @returns {string}
 */
function previewBody(body) {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact.length > 300 ? `${compact.slice(0, 297)}...` : compact;
}

/**
 * Fetches a URL with retries and returns the response body as text.
 *
 * @param {string} url
 * @param {{ attempts?: number, timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
async function fetchText(url, { attempts = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Retries are intentionally sequential so backoff applies between requests.
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      // The response body must be consumed before deciding whether to retry.
      // eslint-disable-next-line no-await-in-loop
      const body = await response.text();

      if (!response.ok) {
        throw new Error(
          `GET ${url} failed with status ${response.status}: ${previewBody(body) || '<empty>'}`,
        );
      }

      return body;
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        // Sleep before the next attempt to avoid hammering the deployed service.
        // eslint-disable-next-line no-await-in-loop
        await sleep(attempt * 1_000);
      }
    }
  }

  throw lastError;
}

/**
 * Parses a JSON response body.
 *
 * @param {string} body
 * @param {string} url
 * @returns {any}
 */
function parseJson(body, url) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Expected JSON from ${url}: ${error.message}`);
  }
}

/**
 * Ensures the health payload indicates a healthy service.
 *
 * @param {unknown} payload
 */
function assertHealthPayload(payload) {
  if (!payload || payload.message !== 'OK') {
    throw new Error('Expected health payload to include message "OK"');
  }
}

/**
 * Extracts Swagger server URLs from the generated Swagger UI init payload.
 *
 * @param {string} swaggerUiInit
 * @returns {string[]}
 */
function extractServerUrls(swaggerUiInit) {
  const serversBlock = swaggerUiInit.match(/"servers"\s*:\s*\[(?<servers>[\s\S]*?)\]\s*,\s*"paths"/);

  if (!serversBlock?.groups?.servers) {
    throw new Error('Unable to locate Swagger servers block');
  }

  const urls = Array.from(
    serversBlock.groups.servers.matchAll(/"url"\s*:\s*"([^"]+)"/g),
    (match) => match[1],
  );

  if (urls.length === 0) {
    throw new Error('Swagger servers block does not contain any URLs');
  }

  return urls;
}

/**
 * Ensures the Swagger UI init payload includes the expected server URL.
 *
 * @param {string} swaggerUiInit
 * @param {string} expectedBaseUrl
 */
function assertSwaggerServerUrl(swaggerUiInit, expectedBaseUrl) {
  const serverUrls = extractServerUrls(swaggerUiInit);

  if (!serverUrls.includes(expectedBaseUrl)) {
    throw new Error(
      `Expected Swagger UI config to include server URL ${expectedBaseUrl}; found ${serverUrls.join(', ')}`,
    );
  }
}

/**
 * Ensures the scraper payload has the expected shape.
 *
 * @param {unknown} payload
 */
function assertScraperPayload(payload) {
  if (!payload || !Array.isArray(payload.imageSources)) {
    throw new Error('Expected scraper payload to include an imageSources array');
  }
}

/**
 * Ensures the Azure description payload has the expected shape.
 *
 * @param {unknown} payload
 */
function assertAzureDescriptionPayload(payload) {
  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error('Expected Azure description payload to be a single-item array');
  }

  if (typeof payload[0]?.description !== 'string' || payload[0].description.trim().length === 0) {
    throw new Error('Expected Azure description payload to include a non-empty description');
  }
}

/**
 * Performs the deploy verification checks against a base URL.
 *
 * @param {string} baseUrl
 * @returns {Promise<string[]>}
 */
async function verifyDeploy(baseUrl) {
  const checks = [];
  const healthUrl = `${baseUrl}/api/health`;
  const swaggerUrl = `${baseUrl}/api-docs/swagger-ui-init.js`;
  const scraperUrl = `${baseUrl}/api/scraper/images?url=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2F`;
  const azureDescriptionUrl = `${baseUrl}/api/accessibility/description?image_source=https%3A%2F%2Fdeveloper.chrome.com%2Fstatic%2Fimages%2Fai-homepage-card.png&model=azure`;

  const healthPayload = parseJson(await fetchText(healthUrl), healthUrl);
  assertHealthPayload(healthPayload);
  checks.push('Health endpoint responded with message "OK".');

  const swaggerUiInit = await fetchText(swaggerUrl);
  assertSwaggerServerUrl(swaggerUiInit, baseUrl);
  checks.push(`Swagger UI advertises ${baseUrl} in the generated servers list.`);

  const scraperPayload = parseJson(
    await fetchText(scraperUrl, { timeoutMs: EXTENDED_TIMEOUT_MS }),
    scraperUrl,
  );
  assertScraperPayload(scraperPayload);
  checks.push('Scraper endpoint returned an imageSources array.');

  const azureDescriptionPayload = parseJson(
    await fetchText(azureDescriptionUrl, {
      attempts: 2,
      timeoutMs: EXTENDED_TIMEOUT_MS,
    }),
    azureDescriptionUrl,
  );
  assertAzureDescriptionPayload(azureDescriptionPayload);
  checks.push('Azure description endpoint returned a non-empty description.');

  return checks;
}

/**
 * Runs the deploy verification CLI.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const checks = await verifyDeploy(baseUrl);

  appendSummary(args.summaryFile, [
    '## Deploy Verification',
    '',
    `- Base URL: ${baseUrl}`,
    `- Event: ${args.event}`,
    '',
    ...checks.map((check) => `- ${check}`),
  ]);

  console.log(`Deploy verification passed for ${baseUrl}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertAzureDescriptionPayload,
  assertHealthPayload,
  assertScraperPayload,
  assertSwaggerServerUrl,
  extractServerUrls,
  normalizeBaseUrl,
  parseArgs,
  verifyDeploy,
};
