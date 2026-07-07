#!/usr/bin/env node

const fs = require('node:fs');

/**
 * @typedef {object} AuditArgs
 * @property {string} outputFile
 * @property {string} reportFile
 */

/**
 * @param {string[]} argv
 * @returns {AuditArgs}
 */
function parseArgs(argv) {
  /** @type {Partial<AuditArgs>} */
  const args = {};

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
      case 'output-file':
        args.outputFile = value;
        break;
      case 'report-file':
        args.reportFile = value;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.outputFile || !args.reportFile) {
    throw new Error('--report-file and --output-file are required');
  }

  return /** @type {AuditArgs} */ (args);
}

/**
 * @typedef {object} AuditVulnerabilities
 * @property {number} [critical]
 * @property {number} [high]
 * @property {number} [low]
 * @property {number} [moderate]
 */

/**
 * @typedef {object} AuditReport
 * @property {{ vulnerabilities?: AuditVulnerabilities }} [metadata]
 * @property {string} [parseError]
 */

/**
 * @param {string} reportFile
 * @returns {{ critical: number, high: number, low: number, moderate: number }}
 */
function parseSecurityAuditReport(reportFile) {
  const fallback = { metadata: { vulnerabilities: {} } };
  /** @type {AuditReport} */
  let report = fallback;

  try {
    const raw = fs.readFileSync(reportFile, 'utf8').trim();
    report = raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    report = {
      ...fallback,
      parseError: error instanceof Error ? error.message : String(error),
    };
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }

  /** @type {AuditVulnerabilities} */
  const vulnerabilities = report.metadata?.vulnerabilities || {};

  return {
    critical: Number(vulnerabilities.critical || 0),
    high: Number(vulnerabilities.high || 0),
    low: Number(vulnerabilities.low || 0),
    moderate: Number(vulnerabilities.moderate || 0),
  };
}

/**
 * @param {string} outputFile
 * @param {string} key
 * @param {string|number} value
 */
function appendOutput(outputFile, key, value) {
  fs.appendFileSync(outputFile, `${key}=${value}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const counts = parseSecurityAuditReport(args.reportFile);

  Object.entries(counts).forEach(([key, value]) => {
    appendOutput(args.outputFile, key, value);
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  appendOutput,
  parseArgs,
  parseSecurityAuditReport,
};
