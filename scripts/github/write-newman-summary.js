#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const {
  buildItemFolderMap,
  readCollection,
} = require('../postman/collection-utils');

const DEFAULT_REPORTS_DIR = path.resolve(__dirname, '..', '..', 'reports', 'newman');
const DEFAULT_COLLECTION_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'postman',
  'collections',
  'alt-text-generator.postman_collection.json',
);
const NO_REPORTS_MESSAGE = 'No Newman JSON reports were available. The Newman run may have exited before reporter output was written.';

/**
 * @param {string[]} argv
 * @returns {{ collectionPath: string, reportsDir: string, summaryFile: string|null }}
 */
function parseArgs(argv) {
  const args = {
    collectionPath: DEFAULT_COLLECTION_PATH,
    reportsDir: DEFAULT_REPORTS_DIR,
    summaryFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for --${key}`);
    }
    index += 1;

    switch (key) {
      case 'collection-path':
        args.collectionPath = value;
        break;
      case 'reports-dir':
        args.reportsDir = value;
        break;
      case 'summary-file':
        args.summaryFile = value;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  return args;
}

/**
 * @param {string} summaryFile
 * @param {string[]} lines
 */
function appendSummary(summaryFile, lines) {
  if (!summaryFile) {
    return;
  }

  fs.appendFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * @param {string} reportsDir
 * @returns {string[]}
 */
function listReportPaths(reportsDir) {
  return fs.readdirSync(reportsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(reportsDir, name));
}

/**
 * @param {string} collectionPath
 * @returns {{ itemFolderMap: Map<string, string>, issues: string[] }}
 */
function loadItemFolderMap(collectionPath) {
  try {
    return {
      itemFolderMap: buildItemFolderMap(readCollection(collectionPath)),
      issues: [],
    };
  } catch (error) {
    return {
      itemFolderMap: new Map(),
      issues: [
        `Unable to read collection metadata from ${collectionPath}: ${error.message}`,
      ],
    };
  }
}

/**
 * @param {object} report
 * @returns {number}
 */
function getReportDurationMs(report) {
  const timings = report.run?.timings;
  if (
    typeof timings?.started === 'number'
    && typeof timings?.completed === 'number'
  ) {
    return timings.completed - timings.started;
  }

  return 0;
}

/**
 * @param {object} report
 * @param {Map<string, string>} itemFolderMap
 * @returns {object}
 */
function summarizeReport(report, itemFolderMap) {
  const label = path.basename(report.reportPath, '.json');
  const folderBreakdown = new Map();
  (report.run?.executions ?? []).forEach((execution) => {
    const folder = itemFolderMap.get(execution.item?.id)
      ?? itemFolderMap.get(execution.item?.name)
      ?? 'unknown';
    const assertionTotal = execution.assertions?.length ?? 0;
    const assertionFailed = (execution.assertions ?? [])
      .filter((assertion) => Boolean(assertion.error))
      .length;
    const responseTimeMs = Number(execution.response?.responseTime) || 0;
    const current = folderBreakdown.get(folder) ?? {
      folder,
      requestTotal: 0,
      assertionTotal: 0,
      assertionFailed: 0,
      totalResponseTimeMs: 0,
      maxResponseTimeMs: 0,
    };

    current.requestTotal += 1;
    current.assertionTotal += assertionTotal;
    current.assertionFailed += assertionFailed;
    current.totalResponseTimeMs += responseTimeMs;
    current.maxResponseTimeMs = Math.max(current.maxResponseTimeMs, responseTimeMs);
    folderBreakdown.set(folder, current);
  });
  const failures = (report.run?.failures ?? []).map((failure) => ({
    source: label,
    folder: itemFolderMap.get(failure.source?.id)
      ?? itemFolderMap.get(failure.source?.name)
      ?? 'unknown',
    requestName: failure.source?.name ?? 'unknown',
    message: failure.error?.message ?? 'Unknown failure',
  }));

  return {
    label,
    durationMs: getReportDurationMs(report),
    requestTotal: report.run?.stats?.requests?.total ?? 0,
    assertionTotal: report.run?.stats?.assertions?.total ?? 0,
    assertionFailed: report.run?.stats?.assertions?.failed ?? 0,
    folders: Array.from(folderBreakdown.values()).map((folder) => ({
      ...folder,
      avgResponseTimeMs: folder.requestTotal === 0
        ? 0
        : Math.round(folder.totalResponseTimeMs / folder.requestTotal),
    })),
    failures,
  };
}

/**
 * @param {object[]} reports
 * @returns {object}
 */
function aggregateSummaries(reports) {
  return reports.reduce((aggregate, report) => ({
    reportCount: aggregate.reportCount + 1,
    requestTotal: aggregate.requestTotal + report.requestTotal,
    assertionTotal: aggregate.assertionTotal + report.assertionTotal,
    assertionFailed: aggregate.assertionFailed + report.assertionFailed,
    failures: aggregate.failures.concat(report.failures),
    folders: report.folders.reduce((folderAggregate, folder) => {
      const current = folderAggregate.get(folder.folder) ?? {
        folder: folder.folder,
        requestTotal: 0,
        assertionTotal: 0,
        assertionFailed: 0,
        totalResponseTimeMs: 0,
        maxResponseTimeMs: 0,
      };

      current.requestTotal += folder.requestTotal;
      current.assertionTotal += folder.assertionTotal;
      current.assertionFailed += folder.assertionFailed;
      current.totalResponseTimeMs += folder.totalResponseTimeMs;
      current.maxResponseTimeMs = Math.max(current.maxResponseTimeMs, folder.maxResponseTimeMs);
      folderAggregate.set(folder.folder, current);
      return folderAggregate;
    }, aggregate.folders),
    reports: aggregate.reports.concat(report),
  }), {
    reportCount: 0,
    requestTotal: 0,
    assertionTotal: 0,
    assertionFailed: 0,
    failures: [],
    folders: new Map(),
    reports: [],
  });
}

/**
 * @param {object} aggregate
 * @param {string[]} [issues]
 * @param {number} [reportDiscoveryCount]
 * @returns {string[]}
 */
function formatSummaryLines(
  aggregate,
  issues = [],
  reportDiscoveryCount = aggregate.reportCount,
) {
  const lines = [
    '## Newman Summary',
    '',
    `- Reports discovered: ${reportDiscoveryCount}`,
    `- Reports parsed: ${aggregate.reportCount}`,
    `- Requests: ${aggregate.requestTotal}`,
    `- Assertions: ${aggregate.assertionTotal}`,
    `- Failed assertions: ${aggregate.assertionFailed}`,
  ];

  if (issues.length > 0) {
    lines.push(`- Summary issues: ${issues.length}`);
  }

  lines.push('', '### Report Breakdown');

  if (aggregate.reports.length === 0) {
    lines.push('- none');
  } else {
    aggregate.reports.forEach((report) => {
      lines.push(
        `- ${report.label}: ${report.requestTotal} requests, `
          + `${report.assertionTotal} assertions, `
          + `${report.assertionFailed} failed, `
          + `${report.durationMs}ms`,
      );
    });
  }

  lines.push('', '### Folder Breakdown');

  const folders = Array.from(aggregate.folders.values())
    .sort((left, right) => left.folder.localeCompare(right.folder));
  if (folders.length === 0) {
    lines.push('- none');
  } else {
    folders.forEach((folder) => {
      const avgResponseTimeMs = folder.requestTotal === 0
        ? 0
        : Math.round(folder.totalResponseTimeMs / folder.requestTotal);
      lines.push(
        `- ${folder.folder}: ${folder.requestTotal} requests, `
          + `${folder.assertionTotal} assertions, `
          + `${folder.assertionFailed} failed, `
          + `avg ${avgResponseTimeMs}ms, max ${folder.maxResponseTimeMs}ms`,
      );
    });
  }

  lines.push('', '### Top Failing Requests');

  if (aggregate.failures.length === 0) {
    lines.push('- none');
  } else {
    aggregate.failures.slice(0, 10).forEach((failure) => {
      lines.push(
        `- [${failure.source}] ${failure.folder} / ${failure.requestName}: ${failure.message}`,
      );
    });
  }

  if (issues.length > 0) {
    lines.push('', '### Summary Issues');
    issues.forEach((issue) => {
      lines.push(`- ${issue}`);
    });
  }

  return lines;
}

/**
 * @param {{ collectionPath: string, reportsDir: string }} args
 * @returns {{ lines: string[], aggregate: object, issues: string[] }}
 */
function buildSummary(args) {
  const { itemFolderMap, issues } = loadItemFolderMap(args.collectionPath);
  let reportPaths = [];

  try {
    reportPaths = listReportPaths(args.reportsDir);
  } catch (error) {
    issues.push(`Unable to read Newman reports from ${args.reportsDir}: ${error.message}`);
  }

  if (reportPaths.length === 0) {
    issues.push(NO_REPORTS_MESSAGE);
  }

  const reports = [];
  reportPaths.forEach((reportPath) => {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      report.reportPath = reportPath;
      reports.push(summarizeReport(report, itemFolderMap));
    } catch (error) {
      issues.push(`Unable to parse Newman JSON report ${path.basename(reportPath)}: ${error.message}`);
    }
  });

  const aggregate = aggregateSummaries(reports);
  return {
    lines: formatSummaryLines(aggregate, issues, reportPaths.length),
    aggregate,
    issues,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { lines } = buildSummary(args);
  appendSummary(args.summaryFile, lines);
  console.log(lines.join('\n'));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  aggregateSummaries,
  buildSummary,
  formatSummaryLines,
  getReportDurationMs,
  listReportPaths,
  parseArgs,
  summarizeReport,
};
