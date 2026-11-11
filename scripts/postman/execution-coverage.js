/**
 * Verifies that a Newman run executed every request in the folders it selected.
 *
 * Newman reports success for whatever subset of requests actually ran, so any
 * run-control call (for example `pm.execution.setNextRequest(null)`) can silently
 * drop the rest of a run while the job stays green. This check compares the
 * report's executions against the selected folders, using the collection Newman
 * embeds in its JSON report so item ids match exactly.
 *
 * A request is exempt only when it declares `pm.execution.skipRequest()` in its
 * own pre-request script (for example a job-status poll that synchronous
 * providers never need).
 */

const fs = require('node:fs');
const path = require('node:path');

const { declaresSkipRequest, listRequestItems } = require('./collection-utils');

/** @typedef {import('./collection-utils').CollectionItem} CollectionItem */
/** @typedef {import('./collection-utils').PostmanCollection} PostmanCollection */

/**
 * @typedef {object} CoverageReport
 * @property {PostmanCollection} [collection]
 * @property {{ executions?: { id?: string, item?: { id?: string, name?: string } }[] }} [run]
 */

/**
 * @typedef {object} UnexecutedRequest
 * @property {string} folder
 * @property {string} requestName
 */

/**
 * @typedef {object} ExecutionCoverage
 * @property {number} requiredTotal
 * @property {number} requiredExecuted
 * @property {number} skippableTotal
 * @property {UnexecutedRequest[]} unexecuted
 * @property {string[]} issues
 */

const MAX_LISTED_UNEXECUTED_REQUESTS = 20;

/**
 * @param {CollectionItem} item
 * @returns {string}
 */
function getItemKey(item) {
  return typeof item.id === 'string' && item.id.length > 0 ? `id:${item.id}` : `name:${item.name}`;
}

/**
 * @param {CoverageReport} report
 * @returns {Set<string>}
 */
function collectExecutedKeys(report) {
  /** @type {Set<string>} */
  const executedKeys = new Set();

  (report.run?.executions ?? []).forEach((execution) => {
    const id = execution.item?.id ?? execution.id;

    if (typeof id === 'string' && id.length > 0) {
      executedKeys.add(`id:${id}`);
    }

    if (typeof execution.item?.name === 'string') {
      executedKeys.add(`name:${execution.item.name}`);
    }
  });

  return executedKeys;
}

/**
 * Computes which selected requests a Newman report did not execute.
 *
 * @param {{ report: CoverageReport, folders: string[] }} options
 * @returns {ExecutionCoverage}
 */
function evaluateExecutionCoverage({ report, folders }) {
  /** @type {ExecutionCoverage} */
  const coverage = {
    requiredTotal: 0,
    requiredExecuted: 0,
    skippableTotal: 0,
    unexecuted: [],
    issues: [],
  };

  if (!report.collection || !Array.isArray(report.collection.item)) {
    coverage.issues.push('report does not embed the executed collection');
    return coverage;
  }

  const selectedFolders = new Set(folders);
  const requestItems = listRequestItems(report.collection)
    .filter(({ topLevelFolderName }) => selectedFolders.has(topLevelFolderName));
  const foundFolders = new Set(requestItems.map(({ topLevelFolderName }) => topLevelFolderName));

  folders
    .filter((folder) => !foundFolders.has(folder))
    .forEach((folder) => {
      coverage.issues.push(`selected folder "${folder}" has no requests in the report collection`);
    });

  const executedKeys = collectExecutedKeys(report);

  requestItems.forEach(({ item, topLevelFolderName }) => {
    if (declaresSkipRequest(item)) {
      coverage.skippableTotal += 1;
      return;
    }

    coverage.requiredTotal += 1;

    if (executedKeys.has(getItemKey(item))) {
      coverage.requiredExecuted += 1;
      return;
    }

    coverage.unexecuted.push({
      folder: topLevelFolderName,
      requestName: String(item.name),
    });
  });

  return coverage;
}

/**
 * Reads a Newman JSON report and evaluates its execution coverage. A missing or
 * unreadable report is reported as an issue, so callers fail closed.
 *
 * @param {{ reportPath: string, folders: string[] }} options
 * @returns {ExecutionCoverage}
 */
function readExecutionCoverage({ reportPath, folders }) {
  /** @type {CoverageReport} */
  let report;

  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return {
      requiredTotal: 0,
      requiredExecuted: 0,
      skippableTotal: 0,
      unexecuted: [],
      issues: [
        `unable to read Newman JSON report ${path.basename(reportPath)}: `
        + `${/** @type {Error} */ (error).message}`,
      ],
    };
  }

  return evaluateExecutionCoverage({ report, folders });
}

/**
 * @param {ExecutionCoverage} coverage
 * @returns {boolean}
 */
function isCoverageComplete(coverage) {
  return coverage.unexecuted.length === 0 && coverage.issues.length === 0;
}

/**
 * Formats coverage diagnostics as indented report lines.
 *
 * @param {ExecutionCoverage} coverage
 * @returns {string[]}
 */
function formatCoverageLines(coverage) {
  const lines = [
    `- request coverage: ${coverage.requiredExecuted}/${coverage.requiredTotal} required requests `
    + `executed (${coverage.skippableTotal} declared skippable)`,
  ];

  if (coverage.unexecuted.length > 0) {
    lines.push(`- unexecuted selected requests (${coverage.unexecuted.length}):`);
    coverage.unexecuted.slice(0, MAX_LISTED_UNEXECUTED_REQUESTS).forEach((request) => {
      lines.push(`  - ${request.folder} / ${request.requestName}`);
    });

    if (coverage.unexecuted.length > MAX_LISTED_UNEXECUTED_REQUESTS) {
      lines.push(`  - ...and ${coverage.unexecuted.length - MAX_LISTED_UNEXECUTED_REQUESTS} more`);
    }
  }

  coverage.issues.forEach((issue) => {
    lines.push(`- coverage issue: ${issue}`);
  });

  return lines;
}

module.exports = {
  evaluateExecutionCoverage,
  formatCoverageLines,
  isCoverageComplete,
  readExecutionCoverage,
};
