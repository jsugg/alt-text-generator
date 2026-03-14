const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { buildReportSummary } = require('./newman-summary');

/**
 * @param {string[]} folders
 * @returns {string}
 */
function formatFolderList(folders) {
  return folders.join(', ');
}

/**
 * @param {{
 *   collectionPath: string,
 *   cwd: string,
 *   exitCode: number|null,
 *   folders: string[],
 *   label: string,
 *   reportPath: string,
 * }} options
 * @returns {string[]}
 */
function buildFailureDiagnosticLines({
  collectionPath,
  cwd,
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

    if (reportSummary.failures.length === 0) {
      lines.push('- top failures: none reported in the Newman JSON report');
    } else {
      lines.push('- top failures:');
      reportSummary.failures.slice(0, 5).forEach((failure) => {
        lines.push(
          `  - ${failure.folder} / ${failure.requestName}: ${failure.message}`,
        );
      });
    }
  }

  if (issues.length > 0) {
    lines.push('- summary issues:');
    issues.forEach((issue) => {
      lines.push(`  - ${issue}`);
    });
  }

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
 * @param {string[]} paths
 */
function removeStaleReports(paths) {
  paths.forEach((reportPath) => {
    try {
      fs.rmSync(reportPath, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
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
 *   reportPath: string,
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
  reportPath,
  writeLog = (message) => process.stdout.write(`${message}\n`),
}) {
  removeStaleReports([
    reportPath,
    reportPath.replace(/\.json$/, '.xml'),
  ]);

  writeLog(
    `[newman] starting ${label} for ${formatFolderList(folders)} `
      + `-> ${path.relative(cwd, reportPath) || path.basename(reportPath)}`,
  );

  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        writeLog(`[newman] ${label} completed successfully`);
        resolve();
        return;
      }

      const lines = buildFailureDiagnosticLines({
        collectionPath,
        cwd,
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
  runNewmanCommand,
};
