#!/usr/bin/env node

/**
 * Summarizes a Jest contract run for logs and the GitHub step summary.
 *
 * Inputs are the Jest JSON results (`jest --json --outputFile=...`) and the
 * request log written by the contract client. Output carries counts, durations,
 * and redacted failure headlines only: request headers, bodies, query strings,
 * and secret values never reach the summary.
 *
 * Usage:
 *   node scripts/contract/summarize-contract-report.js \
 *     [--results <jest-results.json>] [--requests-dir <dir>] \
 *     [--summary-file <path>] [--json]
 */

const fs = require('node:fs');
const path = require('node:path');

const { collectSecretValues, redactText } = require('./redaction');
const { readRequestLogs } = require('./request-log');

/** @typedef {import('./request-log').RequestLogEntry} RequestLogEntry */

/**
 * @typedef {object} JestAssertionResult
 * @property {string} [fullName]
 * @property {string} [title]
 * @property {string} [status]
 * @property {number | null} [duration]
 * @property {string[]} [failureMessages]
 */

/**
 * @typedef {object} JestTestFileResult
 * @property {string} [name]
 * @property {string} [status]
 * @property {number} [startTime]
 * @property {number} [endTime]
 * @property {string} [message]
 * @property {JestAssertionResult[]} [assertionResults]
 */

/**
 * @typedef {object} JestResults
 * @property {boolean} [success]
 * @property {number} [startTime]
 * @property {number} [numTotalTests]
 * @property {number} [numPassedTests]
 * @property {number} [numFailedTests]
 * @property {number} [numPendingTests]
 * @property {number} [numTodoTests]
 * @property {number} [numTotalTestSuites]
 * @property {number} [numFailedTestSuites]
 * @property {JestTestFileResult[]} [testResults]
 */

/**
 * @typedef {object} ContractSummary
 * @property {'passed' | 'failed' | 'unknown'} result
 * @property {{ total: number, failed: number }} testFiles
 * @property {{ total: number, passed: number, failed: number, skipped: number, todo: number }} tests
 * @property {number} durationMs
 * @property {{
 *   total: number,
 *   byTransport: Record<string, number>,
 *   byStatusClass: Record<string, number>,
 *   transportErrors: number,
 * }} requests
 * @property {{ file: string, tests: number, failed: number, durationMs: number }[]} suites
 * @property {{ test: string, message: string }[]} failures
 * @property {string[]} issues
 */

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_REPORT_DIR = path.join(ROOT, 'reports', 'api-contract');
const DEFAULT_RESULTS_PATH = path.join(DEFAULT_REPORT_DIR, 'jest-results.json');
const DEFAULT_REQUESTS_DIR = path.join(DEFAULT_REPORT_DIR, 'requests');
const MAX_LISTED_FAILURES = 10;
const FAILURE_MESSAGE_MAX_LENGTH = 300;
const STACK_LINE_PATTERN = /^\s*at\s/u;

/**
 * Reduces a Jest failure message to its headline (no stack frames).
 *
 * @param {string} message
 * @returns {string}
 */
function extractFailureHeadline(message) {
  return message
    .split('\n')
    .filter((line) => !STACK_LINE_PATTERN.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ');
}

/**
 * @param {RequestLogEntry[]} entries
 * @returns {ContractSummary['requests']}
 */
function summarizeRequests(entries) {
  /** @type {ContractSummary['requests']} */
  const requests = {
    total: entries.length,
    byTransport: {},
    byStatusClass: {},
    transportErrors: 0,
  };

  entries.forEach((entry) => {
    requests.byTransport[entry.transport] = (requests.byTransport[entry.transport] ?? 0) + 1;

    if (typeof entry.status !== 'number') {
      requests.transportErrors += 1;
      return;
    }

    const statusClass = `${Math.floor(entry.status / 100)}xx`;
    requests.byStatusClass[statusClass] = (requests.byStatusClass[statusClass] ?? 0) + 1;
  });

  return requests;
}

/**
 * Builds a redacted summary from Jest results and request-log entries. Log
 * entries older than the Jest run are ignored, so stale logs never inflate counts.
 *
 * @param {{
 *   results: JestResults | null,
 *   requestEntries?: RequestLogEntry[],
 *   issues?: string[],
 *   rootDir?: string,
 *   secretValues?: string[],
 * }} input
 * @returns {ContractSummary}
 */
function buildContractSummary({
  results,
  requestEntries = [],
  issues = [],
  rootDir = ROOT,
  secretValues = collectSecretValues(),
}) {
  const testFiles = results?.testResults ?? [];
  const runStartedAt = typeof results?.startTime === 'number' ? results.startTime : 0;
  const currentEntries = requestEntries.filter((entry) => entry.startedAt >= runStartedAt);
  const startTimes = testFiles.map((file) => file.startTime).filter((value) => typeof value === 'number');
  const endTimes = testFiles.map((file) => file.endTime).filter((value) => typeof value === 'number');
  /** @type {ContractSummary['failures']} */
  const failures = [];

  const suites = testFiles.map((file) => {
    const assertions = file.assertionResults ?? [];
    const failedAssertions = assertions.filter((assertion) => assertion.status === 'failed');

    failedAssertions.forEach((assertion) => {
      failures.push({
        test: redactText(assertion.fullName ?? assertion.title ?? 'unknown test', { secretValues }),
        message: redactText(extractFailureHeadline((assertion.failureMessages ?? []).join('\n')), {
          secretValues,
          maxLength: FAILURE_MESSAGE_MAX_LENGTH,
        }),
      });
    });

    if (file.status === 'failed' && failedAssertions.length === 0 && file.message) {
      failures.push({
        test: '(test file)',
        message: redactText(extractFailureHeadline(file.message), {
          secretValues,
          maxLength: FAILURE_MESSAGE_MAX_LENGTH,
        }),
      });
    }

    return {
      file: path.relative(rootDir, file.name ?? 'unknown').split(path.sep).join('/'),
      tests: assertions.length,
      failed: failedAssertions.length,
      durationMs: (file.endTime ?? 0) - (file.startTime ?? 0),
    };
  });

  /** @type {ContractSummary['result']} */
  let result = 'unknown';
  if (results) {
    result = results.success ? 'passed' : 'failed';
  }

  return {
    result,
    testFiles: {
      total: results?.numTotalTestSuites ?? testFiles.length,
      failed: results?.numFailedTestSuites ?? suites.filter((suite) => suite.failed > 0).length,
    },
    tests: {
      total: results?.numTotalTests ?? 0,
      passed: results?.numPassedTests ?? 0,
      failed: results?.numFailedTests ?? 0,
      skipped: results?.numPendingTests ?? 0,
      todo: results?.numTodoTests ?? 0,
    },
    durationMs: startTimes.length > 0 && endTimes.length > 0
      ? Math.max(...endTimes) - Math.min(...startTimes)
      : 0,
    requests: summarizeRequests(currentEntries),
    suites,
    failures,
    issues: issues.map((issue) => redactText(issue, { secretValues })),
  };
}

/**
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function formatCounts(counts) {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0 ? 'none' : entries.map(([key, count]) => `${key} ${count}`).join(', ');
}

/**
 * @param {ContractSummary} summary
 * @returns {string[]}
 */
function formatSummaryLines(summary) {
  const { tests, requests } = summary;
  const lines = [
    '## API Contract Summary',
    '',
    `- Result: ${summary.result}`,
    `- Test files: ${summary.testFiles.total} (${summary.testFiles.failed} failed)`,
    `- Tests: ${tests.total} total, ${tests.passed} passed, ${tests.failed} failed, `
    + `${tests.skipped} skipped, ${tests.todo} todo`,
    `- Duration: ${summary.durationMs}ms`,
    `- Requests: ${requests.total} (transport: ${formatCounts(requests.byTransport)}; `
    + `status: ${formatCounts(requests.byStatusClass)}; transport errors: ${requests.transportErrors})`,
  ];

  if (summary.issues.length > 0) {
    lines.push(`- Summary issues: ${summary.issues.length}`);
  }

  lines.push('', '### Suite Breakdown');
  if (summary.suites.length === 0) {
    lines.push('- none');
  } else {
    summary.suites.forEach((suite) => {
      lines.push(`- ${suite.file}: ${suite.tests} tests, ${suite.failed} failed, ${suite.durationMs}ms`);
    });
  }

  lines.push('', '### Top Failures');
  if (summary.failures.length === 0) {
    lines.push('- none');
  } else {
    summary.failures.slice(0, MAX_LISTED_FAILURES).forEach((failure) => {
      lines.push(`- ${failure.test}: ${failure.message}`);
    });

    if (summary.failures.length > MAX_LISTED_FAILURES) {
      lines.push(`- ...and ${summary.failures.length - MAX_LISTED_FAILURES} more`);
    }
  }

  if (summary.issues.length > 0) {
    lines.push('', '### Summary Issues');
    summary.issues.forEach((issue) => lines.push(`- ${issue}`));
  }

  return lines;
}

/**
 * @param {string} resultsPath
 * @returns {{ results: JestResults | null, issues: string[] }}
 */
function readJestResults(resultsPath) {
  try {
    return { results: JSON.parse(fs.readFileSync(resultsPath, 'utf8')), issues: [] };
  } catch (error) {
    return {
      results: null,
      issues: [
        `Unable to read Jest results ${path.basename(resultsPath)}: ${/** @type {Error} */ (error).message}`,
      ],
    };
  }
}

/**
 * @param {string[]} argv
 * @returns {{ resultsPath: string, requestsDir: string, summaryFile: string | null, json: boolean }}
 */
function parseArgs(argv) {
  /** @type {{ resultsPath: string, requestsDir: string, summaryFile: string | null, json: boolean }} */
  const args = {
    resultsPath: DEFAULT_RESULTS_PATH,
    requestsDir: DEFAULT_REQUESTS_DIR,
    summaryFile: null,
    json: false,
  };
  /** @type {Record<string, 'resultsPath' | 'requestsDir' | 'summaryFile'>} */
  const valueFlags = {
    '--results': 'resultsPath',
    '--requests-dir': 'requestsDir',
    '--summary-file': 'summaryFile',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--json') {
      args.json = true;
    } else if (Object.hasOwn(valueFlags, token)) {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error(`Missing value for ${token}`);
      }

      index += 1;
      args[valueFlags[token]] = path.resolve(value);
    } else {
      throw new Error(`Unsupported argument: ${token}`);
    }
  }

  return args;
}

/**
 * @param {string[]} argv
 * @returns {number} process exit code
 */
function main(argv) {
  const args = parseArgs(argv);
  const { results, issues } = readJestResults(args.resultsPath);
  const requestLog = readRequestLogs(args.requestsDir);
  const summary = buildContractSummary({
    results,
    requestEntries: requestLog.entries,
    issues: [...issues, ...requestLog.issues],
  });
  const lines = formatSummaryLines(summary);

  if (args.summaryFile) {
    fs.appendFileSync(args.summaryFile, `${lines.join('\n')}\n`, 'utf8');
  }

  process.stdout.write(args.json ? `${JSON.stringify(summary, null, 2)}\n` : `${lines.join('\n')}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`contract:summary ${/** @type {Error} */ (error).message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  DEFAULT_REQUESTS_DIR,
  DEFAULT_RESULTS_PATH,
  buildContractSummary,
  extractFailureHeadline,
  formatSummaryLines,
  main,
  parseArgs,
};
