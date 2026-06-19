#!/usr/bin/env node

/**
 * Freshness gate for the committed OpenAPI artifact.
 *
 * config/swagger.js serves docs/openapi.base.json verbatim, so the committed
 * file MUST be byte-for-byte what `npm run openapi:generate` produces from the
 * current JSDoc sources. This gate regenerates the spec in memory and compares
 * it to the committed bytes; a mismatch means the artifact is stale and a route
 * or controller change shipped without regenerating the contract.
 *
 * On drift it prints a structural summary (which paths/schemas the sources add
 * or drop relative to the committed file) so the fix is obvious. Exit 0 = fresh,
 * 1 = stale or missing, 2 = usage/IO error.
 *
 * Usage: node scripts/openapi/check-freshness.js [--spec <path>] [--json]
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  GENERATED_SPEC_PATH,
  generateFreshSpec,
  serializeSpec,
} = require('./spec-utils');

const USAGE = `Usage: node scripts/openapi/check-freshness.js [options]

Fails when the committed OpenAPI artifact (docs/openapi.base.json) does not match
what the current JSDoc sources generate. Run "npm run openapi:generate" to refresh
it after changing routes, controllers, or the swagger base definition.

Options:
  --spec <path>  Compare against a specific committed spec file
  --json         Emit machine-readable JSON results
  -h, --help     Show this help
`;

function keysOf(value) {
  return value !== null && typeof value === 'object' ? Object.keys(value) : [];
}

function difference(a, b) {
  const other = new Set(b);
  return a.filter((key) => !other.has(key));
}

/**
 * Summarizes the structural drift of the committed spec relative to a fresh one.
 * "added" = present in the freshly generated sources but missing from the
 * committed artifact; "removed" = present in the committed artifact but no longer
 * generated.
 *
 * @param {object} committedSpec
 * @param {object} freshSpec
 * @returns {{ pathsAdded: string[], pathsRemoved: string[], schemasAdded: string[], schemasRemoved: string[] }}
 */
function summarizeDrift(committedSpec, freshSpec) {
  const committedPaths = keysOf(committedSpec.paths);
  const freshPaths = keysOf(freshSpec.paths);
  const committedSchemas = keysOf(committedSpec?.components?.schemas);
  const freshSchemas = keysOf(freshSpec?.components?.schemas);

  return {
    pathsAdded: difference(freshPaths, committedPaths),
    pathsRemoved: difference(committedPaths, freshPaths),
    schemasAdded: difference(freshSchemas, committedSchemas),
    schemasRemoved: difference(committedSchemas, freshSchemas),
  };
}

/**
 * Compares committed spec text against freshly generated text.
 *
 * @param {{ committedText: string, freshText: string }} input
 * @returns {{ fresh: boolean, drift: object | null }}
 */
function checkFreshness({ committedText, freshText }) {
  if (committedText === freshText) {
    return { fresh: true, drift: null };
  }

  return {
    fresh: false,
    drift: summarizeDrift(JSON.parse(committedText), JSON.parse(freshText)),
  };
}

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{ specPath: string, json: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const args = { specPath: GENERATED_SPEC_PATH, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--spec') {
      i += 1;

      if (typeof argv[i] !== 'string') {
        throw new Error('--spec requires a path argument');
      }

      args.specPath = path.resolve(argv[i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

/**
 * Lists the drift lines for a human-readable report.
 *
 * @param {object} drift
 * @returns {string[]}
 */
function driftLines(drift) {
  return [
    ['path(s) only in committed artifact (removed from sources)', drift.pathsRemoved],
    ['path(s) only in sources (missing from artifact)', drift.pathsAdded],
    ['schema(s) only in committed artifact (removed from sources)', drift.schemasRemoved],
    ['schema(s) only in sources (missing from artifact)', drift.schemasAdded],
  ]
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => `    - ${items.length} ${label}: ${items.join(', ')}`);
}

/**
 * Writes a human-readable freshness report.
 *
 * @param {{ result: object, specPath: string }} report
 */
function writeReport({ result, specPath }) {
  const relativePath = path.relative(process.cwd(), specPath) || specPath;

  if (result.fresh) {
    process.stdout.write(
      `openapi:check OK ${relativePath} matches the generated contract\n`,
    );
    return;
  }

  process.stderr.write(
    `openapi:check FAILED: ${relativePath} is stale (does not match the generated contract)\n`,
  );

  const lines = driftLines(result.drift);

  if (lines.length > 0) {
    process.stderr.write('\n  Structural drift:\n');
    process.stderr.write(`${lines.join('\n')}\n`);
  } else {
    process.stderr.write(
      '\n  Path and schema names match; a field-level detail differs.\n',
    );
  }

  process.stderr.write('\nRun "npm run openapi:generate" and commit docs/openapi.base.json.\n');
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv
 * @returns {number} process exit code
 */
function main(argv) {
  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`openapi:check ${error.message}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (!fs.existsSync(args.specPath)) {
    process.stderr.write(
      `openapi:check FAILED: ${args.specPath} is missing. `
      + 'Run "npm run openapi:generate" and commit it.\n',
    );
    return 1;
  }

  let result;

  try {
    result = checkFreshness({
      committedText: fs.readFileSync(args.specPath, 'utf8'),
      freshText: serializeSpec(generateFreshSpec()),
    });
  } catch (error) {
    process.stderr.write(`openapi:check failed to compute freshness: ${error.message}\n`);
    return 2;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    writeReport({ result, specPath: args.specPath });
  }

  return result.fresh ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  checkFreshness,
  main,
  parseArgs,
  summarizeDrift,
};
