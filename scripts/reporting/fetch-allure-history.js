#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 5_000;
const HISTORY_FILENAMES = Object.freeze([
  'categories-trend.json',
  'duration-trend.json',
  'history-trend.json',
  'history.json',
  'retry-trend.json',
]);

/**
 * Normalizes a public report URL by trimming trailing slashes.
 *
 * @param {string} reportUrl
 * @returns {string}
 */
function normalizeReportUrl(reportUrl) {
  return reportUrl.replace(/\/+$/u, '');
}

/**
 * Builds the public URL for a specific Allure history file.
 *
 * @param {string} reportUrl
 * @param {string} filename
 * @returns {string}
 */
function buildHistoryFileUrl(reportUrl, filename) {
  return `${normalizeReportUrl(reportUrl)}/history/${filename}`;
}

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{ reportUrl: string | null, resultsDir: string, timeoutMs: number }}
 */
function parseArgs(argv) {
  let reportUrl = null;
  let resultsDir = null;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--report-url') {
      reportUrl = argv[index + 1] || null;
      index += 1;
    } else if (token === '--results-dir') {
      resultsDir = argv[index + 1] || null;
      index += 1;
    } else if (token === '--timeout-ms') {
      timeoutMs = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!resultsDir) {
    throw new Error('Missing required argument: --results-dir <path>');
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Expected --timeout-ms to be a positive number');
  }

  return {
    reportUrl: reportUrl ? normalizeReportUrl(reportUrl) : null,
    resultsDir: path.resolve(process.cwd(), resultsDir),
    timeoutMs,
  };
}

/**
 * Fetches a single history file from the previously published report.
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   filename: string,
 *   reportUrl: string,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<{
 *   content?: string,
 *   filename: string,
 *   status: 'restored' | 'missing' | 'error',
 *   url: string,
 *   message?: string,
 * }>}
 */
async function fetchHistoryFile({
  filename,
  reportUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const url = buildHistoryFileUrl(reportUrl, filename);

  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 404) {
      return {
        filename,
        status: 'missing',
        url,
      };
    }

    if (!response.ok) {
      return {
        filename,
        status: 'error',
        url,
        message: `unexpected status ${response.status}`,
      };
    }

    const content = await response.text();
    JSON.parse(content);

    return {
      content: `${content.trimEnd()}\n`,
      filename,
      status: 'restored',
      url,
    };
  } catch (error) {
    return {
      filename,
      status: 'error',
      url,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Restores Allure history files into the given results directory.
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   logger?: Pick<Console, 'info' | 'warn'>,
 *   reportUrl: string | null,
 *   resultsDir: string,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<{
 *   errors: { filename: string, message: string, url: string }[],
 *   restoredFiles: string[],
 *   skippedFiles: string[],
 * }>}
 */
async function restoreAllureHistory({
  reportUrl,
  resultsDir,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
}) {
  if (!reportUrl) {
    logger.info?.('No public Allure report URL configured; skipping history restore.');
    return {
      errors: [],
      restoredFiles: [],
      skippedFiles: [...HISTORY_FILENAMES],
    };
  }

  const historyDir = path.join(resultsDir, 'history');
  await fs.mkdir(historyDir, { recursive: true });

  const results = await Promise.all(HISTORY_FILENAMES.map((filename) => fetchHistoryFile({
    fetchImpl,
    filename,
    reportUrl,
    timeoutMs,
  })));

  const restoredResults = results.filter((result) => result.status === 'restored');
  const skippedResults = results.filter((result) => result.status === 'missing');
  const errorResults = results.filter((result) => result.status === 'error');

  await Promise.all(restoredResults.map((result) => fs.writeFile(
    path.join(historyDir, result.filename),
    result.content,
    'utf8',
  )));

  errorResults.forEach((result) => {
    logger.warn?.(
      `Unable to restore Allure history file ${result.filename} from ${result.url}: ${result.message || 'unknown error'}`,
    );
  });

  const errors = errorResults.map((result) => ({
    filename: result.filename,
    message: result.message || 'unknown error',
    url: result.url,
  }));
  const restoredFiles = restoredResults.map((result) => result.filename);
  const skippedFiles = skippedResults.map((result) => result.filename);

  if (restoredFiles.length === 0) {
    await fs.rm(historyDir, { force: true, recursive: true });
  }

  return {
    errors,
    restoredFiles,
    skippedFiles,
  };
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));

  restoreAllureHistory(options)
    .then(({ errors, restoredFiles, skippedFiles }) => {
      // eslint-disable-next-line no-console
      console.info(
        `Allure history restore complete: restored=${restoredFiles.length}, skipped=${skippedFiles.length}, errors=${errors.length}`,
      );
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  HISTORY_FILENAMES,
  buildHistoryFileUrl,
  fetchHistoryFile,
  normalizeReportUrl,
  parseArgs,
  restoreAllureHistory,
};
