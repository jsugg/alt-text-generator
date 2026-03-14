#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const {
  aggregateSummaries,
  buildSummary,
  formatSummaryLines,
  getReportDurationMs,
  listReportPaths,
  summarizeReport,
} = require('../postman/newman-summary');

const DEFAULT_REPORTS_DIR = path.resolve(__dirname, '..', '..', 'reports', 'newman');
const DEFAULT_COLLECTION_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'postman',
  'collections',
  'alt-text-generator.postman_collection.json',
);

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
  appendSummary,
  buildSummary,
  formatSummaryLines,
  getReportDurationMs,
  listReportPaths,
  parseArgs,
  summarizeReport,
};
