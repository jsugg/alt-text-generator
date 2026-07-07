const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  FAILURE_CATEGORY_HTTP_CONTRACT,
  FAILURE_CATEGORY_PERFORMANCE_BUDGET,
  buildReportSummary,
} = require('./newman-summary');

/** @typedef {import('./newman-summary').FailureRecord} FailureRecord */

const DIAGNOSTIC_LOG_TAIL_BYTES = 6000;
const DIAGNOSTIC_LOG_TAIL_LINES = 30;

/**
 * @param {string[]} folders
 * @returns {string}
 */
function formatFolderList(folders) {
  return folders.join(', ');
}

/**
 * @param {FailureRecord[]} failures
 * @param {string} category
 * @returns {FailureRecord[]}
 */
function filterFailuresByCategory(failures, category) {
  return failures.filter((failure) => failure.category === category);
}

/**
 * @param {FailureRecord} failure
 * @returns {string}
 */
function formatFailureDiagnosticLine(failure) {
  const assertionSuffix = failure.assertion ? ` (${failure.assertion})` : '';
  return `  - ${failure.folder} / ${failure.requestName}${assertionSuffix}: ${failure.message}`;
}

/**
 * @param {string[]} lines
 * @param {string} heading
 * @param {FailureRecord[]} failures
 */
function appendFailureDiagnostics(lines, heading, failures) {
  if (failures.length === 0) {
    lines.push(`- ${heading}: none`);
    return;
  }

  lines.push(`- ${heading}:`);
  failures.slice(0, 5).forEach((failure) => {
    lines.push(formatFailureDiagnosticLine(failure));
  });
}

/**
 * @param {string} logPath
 * @param {number} [maxBytes]
 * @returns {string[]}
 */
function readDiagnosticLogTail(logPath, maxBytes = DIAGNOSTIC_LOG_TAIL_BYTES) {
  if (!fs.existsSync(logPath)) {
    return ['(missing)'];
  }

  const stats = fs.statSync(logPath);
  const size = Math.min(stats.size, maxBytes);
  const buffer = Buffer.alloc(size);
  const fd = fs.openSync(logPath, 'r');

  try {
    fs.readSync(
      fd,
      /** @type {NodeJS.ArrayBufferView} */ (/** @type {unknown} */ (buffer)),
      0,
      size,
      Math.max(0, stats.size - size),
    );
  } finally {
    fs.closeSync(fd);
  }

  const logText = buffer.toString('utf8').trimEnd();
  if (!logText) {
    return ['(empty)'];
  }

  return logText.split(/\r?\n/u).slice(-DIAGNOSTIC_LOG_TAIL_LINES);
}

/**
 * @param {string[]} lines
 * @param {{ label: string, path: string }[]} diagnosticLogs
 * @param {string} cwd
 */
function appendDiagnosticLogs(lines, diagnosticLogs, cwd) {
  if (diagnosticLogs.length === 0) {
    return;
  }

  lines.push('- diagnostic logs:');
  diagnosticLogs.forEach((diagnosticLog) => {
    const relativeLogPath = path.relative(cwd, diagnosticLog.path)
      || path.basename(diagnosticLog.path);
    lines.push(`  - ${diagnosticLog.label}: ${relativeLogPath}`);
    readDiagnosticLogTail(diagnosticLog.path).forEach((line) => {
      lines.push(`    ${line}`);
    });
  });
}

/**
 * @param {{
 *   collectionPath: string,
 *   cwd: string,
 *   exitCode: number|null,
 *   folders: string[],
 *   label: string,
 *   reportPath: string,
 *   diagnosticLogs?: { label: string, path: string }[],
 * }} options
 * @returns {string[]}
 */
function buildFailureDiagnosticLines({
  collectionPath,
  cwd,
  diagnosticLogs = [],
  exitCode,
  folders,
  label,
  reportPath,
}) {
  const relativeReportPath = path.relative(cwd, reportPath) || path.basename(reportPath);
  const headerLine = `[newman] ${label} failed with exit code ${exitCode ?? 'unknown'}`;
  const lines = [
    headerLine,
    `- folders: ${formatFolderList(folders)}`,
    `- report: ${relativeReportPath}`,
  ];

  if (!fs.existsSync(reportPath)) {
    lines.push('- summary: no JSON report was produced; inspect Newman CLI output above.');
    appendDiagnosticLogs(lines, diagnosticLogs, cwd);
    return lines;
  }

  const { issues, reportSummary } = buildReportSummary({
    collectionPath,
    reportPath,
  });

  if (reportSummary) {
    lines.push(
      `- stats: ${reportSummary.requestTotal} requests, `
      + `${reportSummary.assertionTotal} assertions, `
      + `${reportSummary.assertionFailed} failed, `
      + `${reportSummary.durationMs}ms`,
    );

    const httpContractFailures = filterFailuresByCategory(
      reportSummary.failures,
      FAILURE_CATEGORY_HTTP_CONTRACT,
    );
    const performanceBudgetFailures = filterFailuresByCategory(
      reportSummary.failures,
      FAILURE_CATEGORY_PERFORMANCE_BUDGET,
    );

    lines.push(
      `- failure categories: ${httpContractFailures.length} HTTP contract, `
      + `${performanceBudgetFailures.length} performance budget`,
    );
    appendFailureDiagnostics(lines, 'top HTTP contract failures', httpContractFailures);
    appendFailureDiagnostics(lines, 'top performance budget failures', performanceBudgetFailures);
  }

  if (issues.length > 0) {
    lines.push('- summary issues:');
    issues.forEach((issue) => {
      lines.push(`  - ${issue}`);
    });
  }

  appendDiagnosticLogs(lines, diagnosticLogs, cwd);
  return lines;
}

/**
 * @param {string[]} lines
 * @param {(message: string) => void} writeLog
 */
function emitDiagnosticLines(lines, writeLog) {
  writeLog('::group::Newman Failure Diagnostics');
  lines.forEach((line) => writeLog(line));
  writeLog('::endgroup::');
}

/**
 * @param {(string | null)[]} paths
 */
function removeStaleReports(paths) {
  paths.forEach((reportPath) => {
    if (!reportPath) {
      return;
    }

    try {
      fs.rmSync(reportPath, { force: true });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
        throw error;
      }
    }
  });
}

/**
 * @param {{
 *   args: string[],
 *   collectionPath: string,
 *   cwd: string,
 *   env?: NodeJS.ProcessEnv,
 *   folders: string[],
 *   label: string,
 *   newmanLogPath?: string | null,
 *   reportPath: string,
 *   diagnosticLogs?: { label: string, path: string }[],
 *   writeLog?: (message: string) => void,
 * }} options
 * @returns {Promise<void>}
 */
function runNewmanCommand({
  args,
  collectionPath,
  cwd,
  env = process.env,
  folders,
  label,
  newmanLogPath = null,
  reportPath,
  diagnosticLogs = [],
  writeLog = (message) => process.stdout.write(`${message}\n`),
}) {
  removeStaleReports([
    reportPath,
    reportPath.replace(/\.json$/, '.xml'),
    newmanLogPath,
  ]);

  if (newmanLogPath) {
    fs.mkdirSync(path.dirname(newmanLogPath), { recursive: true });
    fs.writeFileSync(newmanLogPath, '');
  }

  writeLog(
    `[newman] starting ${label} for ${formatFolderList(folders)} `
    + `-> ${path.relative(cwd, reportPath) || path.basename(reportPath)}`,
  );

  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env,
      stdio: newmanLogPath ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    const failureDiagnosticLogs = newmanLogPath
      ? [{ label: 'newman', path: newmanLogPath }, ...diagnosticLogs]
      : diagnosticLogs;

    if (newmanLogPath && child.stdout && child.stderr) {
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        fs.appendFileSync(newmanLogPath, chunk);
      });
      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
        fs.appendFileSync(newmanLogPath, chunk);
      });
    }

    child.on('exit', (code) => {
      if (code === 0) {
        writeLog(`[newman] ${label} completed successfully`);
        resolve();
        return;
      }

      const lines = buildFailureDiagnosticLines({
        collectionPath,
        cwd,
        diagnosticLogs: failureDiagnosticLogs,
        exitCode: code,
        folders,
        label,
        reportPath,
      });
      emitDiagnosticLines(lines, writeLog);
      reject(new Error(
        `${lines[0]} `
        + `(report: ${path.relative(cwd, reportPath) || path.basename(reportPath)})`,
      ));
    });

    child.on('error', reject);
  });
}

module.exports = {
  buildFailureDiagnosticLines,
  emitDiagnosticLines,
  readDiagnosticLogTail,
  runNewmanCommand,
};
