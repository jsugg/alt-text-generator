/**
 * NDJSON log of contract HTTP exchanges, read back by the report summarizer.
 *
 * Only redaction-safe metadata is recorded: transport, method, path without its
 * query string, status, timing, and the owning test name. Headers and bodies are
 * never written. Each process appends to its own file so parallel Jest workers
 * never interleave partial lines.
 */

const fs = require('node:fs');
const path = require('node:path');

const { redactRequestPath } = require('./redaction');

/** @typedef {import('./contract-client').ContractExchange} ContractExchange */

/**
 * @typedef {object} RequestLogEntry
 * @property {string} transport
 * @property {string} method
 * @property {string} path
 * @property {number | null} status
 * @property {number} startedAt epoch milliseconds
 * @property {number} durationMs
 * @property {string | null} testName
 * @property {string | null} error
 */

const REQUEST_LOG_FILE_PATTERN = /^requests-.+\.ndjson$/u;

/**
 * Creates an exchange observer that appends one JSON line per exchange.
 *
 * @param {{
 *   dir: string,
 *   fileName?: string,
 *   resolveTestName?: () => string | null | undefined,
 * }} options
 * @returns {(exchange: ContractExchange) => void}
 */
function createRequestLogRecorder({
  dir,
  fileName = `requests-${process.pid}.ndjson`,
  resolveTestName = () => null,
}) {
  const logPath = path.join(dir, fileName);
  fs.mkdirSync(dir, { recursive: true });

  return (exchange) => {
    /** @type {RequestLogEntry} */
    const entry = {
      transport: exchange.transport,
      method: exchange.method,
      path: redactRequestPath(exchange.path),
      status: exchange.status,
      startedAt: exchange.startedAt,
      durationMs: exchange.durationMs,
      testName: resolveTestName() ?? null,
      error: exchange.error ? exchange.error.name : null,
    };

    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  };
}

/**
 * Reads every request log in a directory, skipping malformed lines.
 *
 * @param {string} dir
 * @returns {{ entries: RequestLogEntry[], issues: string[] }}
 */
function readRequestLogs(dir) {
  /** @type {RequestLogEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const issues = [];
  /** @type {string[]} */
  let fileNames;

  try {
    fileNames = fs.readdirSync(dir).filter((name) => REQUEST_LOG_FILE_PATTERN.test(name)).sort();
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return { entries, issues };
    }

    throw error;
  }

  fileNames.forEach((fileName) => {
    fs.readFileSync(path.join(dir, fileName), 'utf8')
      .split('\n')
      .forEach((line, lineIndex) => {
        if (line.trim() === '') {
          return;
        }

        try {
          entries.push(JSON.parse(line));
        } catch {
          issues.push(`skipped malformed request log line ${fileName}:${lineIndex + 1}`);
        }
      });
  });

  return { entries, issues };
}

module.exports = {
  createRequestLogRecorder,
  readRequestLogs,
};
