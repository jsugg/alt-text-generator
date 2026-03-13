#!/usr/bin/env node

const fs = require('node:fs');

function parseArgs(argv) {
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

  return args;
}

function parseSecurityAuditReport(reportFile) {
  const fallback = { metadata: { vulnerabilities: {} } };
  let report = fallback;

  try {
    const raw = fs.readFileSync(reportFile, 'utf8').trim();
    report = raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    report = {
      ...fallback,
      parseError: error.message,
    };
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }

  const vulnerabilities = report.metadata?.vulnerabilities || {};

  return {
    critical: Number(vulnerabilities.critical || 0),
    high: Number(vulnerabilities.high || 0),
    low: Number(vulnerabilities.low || 0),
    moderate: Number(vulnerabilities.moderate || 0),
  };
}

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
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  appendOutput,
  parseArgs,
  parseSecurityAuditReport,
};
