#!/usr/bin/env node

/**
 * Minimal backward-compatibility gate for the public OpenAPI contract.
 *
 * It diffs the working-tree spec against a git baseline (default: origin/main,
 * then main) and fails only on changes that break existing consumers:
 *
 *   - removed-path             : a documented path disappeared
 *   - removed-operation        : a method disappeared from a kept path
 *   - removed-response         : a response status disappeared from an operation
 *   - removed-required-property: a guaranteed response field (a `required` entry
 *                                on a component schema) was dropped
 *
 * Additive changes (new paths, operations, responses, optional fields) are not
 * breaking and are ignored. When no baseline can be resolved (first introduction
 * of the artifact, a shallow checkout, or a detached history) the gate is a
 * no-op unless `--strict` is passed, so it never blocks on missing history.
 *
 * Exit 0 = compatible (or no baseline), 1 = breaking change (or strict miss),
 * 2 = usage/IO error.
 *
 * Usage: node scripts/openapi/diff-contract.js [--base <ref>] [--spec <path>] [--strict] [--json]
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { GENERATED_SPEC_PATH, HTTP_METHODS, loadSpec } = require('./spec-utils');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BASE_REFS = ['origin/main', 'main'];

const KINDS = {
  REMOVED_PATH: 'removed-path',
  REMOVED_OPERATION: 'removed-operation',
  REMOVED_RESPONSE: 'removed-response',
  REMOVED_REQUIRED_PROPERTY: 'removed-required-property',
};

const USAGE = `Usage: node scripts/openapi/diff-contract.js [options]

Fails when the working-tree OpenAPI spec drops a path, operation, response, or
required response field relative to a git baseline. Additive changes are allowed.
With no resolvable baseline the gate is a no-op unless --strict is given.

Options:
  --base <ref>   Git ref to diff against (default: origin/main, then main)
  --spec <path>  Working-tree spec to check (default: docs/openapi.base.json)
  --strict       Fail when no baseline can be resolved instead of skipping
  --json         Emit machine-readable JSON results
  -h, --help     Show this help
`;

function methodsOf(pathItem) {
  if (pathItem === null || typeof pathItem !== 'object') {
    return [];
  }

  return Object.keys(pathItem).filter((key) => HTTP_METHODS.has(key.toLowerCase()));
}

function responseStatusesOf(operation) {
  const responses = operation?.responses;
  return responses !== null && typeof responses === 'object' ? Object.keys(responses) : [];
}

function requiredOf(schema) {
  return Array.isArray(schema?.required) ? schema.required : [];
}

function pathsOf(spec) {
  return spec?.paths !== null && typeof spec?.paths === 'object' ? spec.paths : {};
}

function schemasOf(spec) {
  const schemas = spec?.components?.schemas;
  return schemas !== null && typeof schemas === 'object' ? schemas : {};
}

/**
 * Diffs response statuses for a single kept operation.
 *
 * @param {string} location
 * @param {object} baseOperation
 * @param {object} nextOperation
 * @returns {{ kind: string, location: string, detail: string }[]}
 */
function diffResponses(location, baseOperation, nextOperation) {
  const nextStatuses = new Set(responseStatusesOf(nextOperation));

  return responseStatusesOf(baseOperation)
    .filter((status) => !nextStatuses.has(status))
    .map((status) => ({
      kind: KINDS.REMOVED_RESPONSE,
      location,
      detail: `response ${status} removed`,
    }));
}

/**
 * Diffs operations (and their responses) for a single kept path.
 *
 * @param {string} routePath
 * @param {object} basePathItem
 * @param {object} nextPathItem
 * @returns {{ kind: string, location: string, detail: string }[]}
 */
function diffOperations(routePath, basePathItem, nextPathItem) {
  const nextMethods = new Set(methodsOf(nextPathItem));

  return methodsOf(basePathItem).flatMap((method) => {
    const location = `${method.toUpperCase()} ${routePath}`;

    if (!nextMethods.has(method)) {
      return [{ kind: KINDS.REMOVED_OPERATION, location, detail: 'operation removed' }];
    }

    return diffResponses(location, basePathItem[method], nextPathItem[method]);
  });
}

/**
 * Diffs `required` arrays of component schemas (the guaranteed response fields).
 *
 * @param {object} baseSpec
 * @param {object} nextSpec
 * @returns {{ kind: string, location: string, detail: string }[]}
 */
function diffRequiredProperties(baseSpec, nextSpec) {
  const nextSchemas = schemasOf(nextSpec);

  return Object.entries(schemasOf(baseSpec)).flatMap(([name, baseSchema]) => {
    if (!(name in nextSchemas)) {
      return [];
    }

    const stillRequired = new Set(requiredOf(nextSchemas[name]));

    return requiredOf(baseSchema)
      .filter((field) => !stillRequired.has(field))
      .map((field) => ({
        kind: KINDS.REMOVED_REQUIRED_PROPERTY,
        location: `components.schemas.${name}`,
        detail: `required property "${field}" removed`,
      }));
  });
}

/**
 * Diffs the public contract surface, returning only breaking changes.
 *
 * @param {object} baseSpec
 * @param {object} nextSpec
 * @returns {{ kind: string, location: string, detail: string }[]}
 */
function diffPublicContract(baseSpec, nextSpec) {
  const nextPaths = pathsOf(nextSpec);

  const pathChanges = Object.entries(pathsOf(baseSpec)).flatMap(([routePath, basePathItem]) => {
    if (!(routePath in nextPaths)) {
      return [{ kind: KINDS.REMOVED_PATH, location: routePath, detail: 'path removed' }];
    }

    return diffOperations(routePath, basePathItem, nextPaths[routePath]);
  });

  return pathChanges.concat(diffRequiredProperties(baseSpec, nextSpec));
}

/**
 * Resolves the first git baseline that yields the spec file, trying each ref in
 * order. Returns null when none resolve (missing ref or file absent on the ref).
 *
 * @param {{ refs: string[], repoRelPath: string, runGit: (args: string[]) => string }} input
 * @returns {{ ref: string, text: string } | null}
 */
function resolveBaseline({ refs, repoRelPath, runGit }) {
  for (let i = 0; i < refs.length; i += 1) {
    try {
      return { ref: refs[i], text: runGit(['show', `${refs[i]}:${repoRelPath}`]) };
    } catch {
      // Ref or file not present on this ref; fall through to the next candidate.
    }
  }

  return null;
}

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{ base: string|null, specPath: string, strict: boolean, json: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const args = {
    base: null, specPath: GENERATED_SPEC_PATH, strict: false, json: false, help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--base') {
      i += 1;

      if (typeof argv[i] !== 'string') {
        throw new Error('--base requires a ref argument');
      }

      args.base = argv[i];
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
 * Writes a human-readable backward-compatibility report.
 *
 * @param {{ baselineRef: string|null, breaking: object[], specPath: string }} report
 */
function writeReport({ baselineRef, breaking, specPath }) {
  const relativePath = path.relative(process.cwd(), specPath) || specPath;

  if (breaking.length === 0) {
    process.stdout.write(
      `openapi:diff OK ${relativePath} is backward compatible with ${baselineRef}\n`,
    );
    return;
  }

  process.stderr.write(
    `openapi:diff FAILED: ${breaking.length} breaking change(s) in ${relativePath} vs ${baselineRef}\n`,
  );

  const byKind = breaking.reduce((acc, change) => {
    const list = acc.get(change.kind) ?? [];
    list.push(change);
    acc.set(change.kind, list);
    return acc;
  }, new Map());

  byKind.forEach((list, kind) => {
    process.stderr.write(`\n  [${kind}] ${list.length} change(s):\n`);
    list.forEach((change) => {
      process.stderr.write(`    - ${change.location}: ${change.detail}\n`);
    });
  });

  process.stderr.write(
    '\nBreaking the public contract requires an explicit version bump; '
    + 'restore the surface or coordinate the change.\n',
  );
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv
 * @param {{ runGit?: (args: string[]) => string }} [deps]
 * @returns {number} process exit code
 */
function main(argv, { runGit } = {}) {
  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`openapi:diff ${error.message}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const git = runGit ?? ((gitArgs) => execFileSync('git', gitArgs, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }));

  const refs = args.base ? [args.base] : DEFAULT_BASE_REFS;
  const repoRelPath = path.relative(PROJECT_ROOT, args.specPath).split(path.sep).join('/');

  const baseline = resolveBaseline({ refs, repoRelPath, runGit: git });

  if (!baseline) {
    const message = `no baseline spec found at refs [${refs.join(', ')}]`;

    if (args.strict) {
      process.stderr.write(`openapi:diff FAILED: ${message} (--strict)\n`);
      return 1;
    }

    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, baselineRef: null, breaking: [] }, null, 2)}\n`);
    } else {
      process.stdout.write(`openapi:diff SKIPPED: ${message}; nothing to compare\n`);
    }

    return 0;
  }

  let breaking;

  try {
    breaking = diffPublicContract(JSON.parse(baseline.text), loadSpec(args.specPath));
  } catch (error) {
    process.stderr.write(`openapi:diff failed to diff specs: ${error.message}\n`);
    return 2;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      ok: breaking.length === 0, baselineRef: baseline.ref, breaking,
    }, null, 2)}\n`);
  } else {
    writeReport({ baselineRef: baseline.ref, breaking, specPath: args.specPath });
  }

  return breaking.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  DEFAULT_BASE_REFS,
  KINDS,
  diffPublicContract,
  main,
  parseArgs,
  resolveBaseline,
};
