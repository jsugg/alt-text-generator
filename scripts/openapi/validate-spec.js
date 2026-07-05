#!/usr/bin/env node

/**
 * Structural validator for the committed OpenAPI artifact.
 *
 * This is the "is the document well-formed enough to serve and generate clients
 * from" gate. It deliberately checks structure, not semantics: example values,
 * enum membership and required-field choices are public-contract decisions
 * asserted by the swagger unit tests, while this gate guarantees the spec is a
 * coherent OpenAPI 3 document that swagger-ui and codegen can consume:
 *
 *   - openapi-version    : declares a 3.x `openapi` version
 *   - info-metadata      : non-empty info.title and info.version
 *   - no-runtime-servers : base artifact stays server-agnostic (servers are
 *                          injected per environment at serve time)
 *   - paths-present      : at least one documented path
 *   - operation-responses: every operation declares responses, and every JSON
 *                          response body declares a schema
 *   - resolvable-refs    : every local $ref resolves within the document
 *   - security-resolvable: every security requirement names a declared scheme
 *
 * Every violation reports its `location` (operation, ref, or section) so a
 * failure points at the exact thing to fix. Exit 0 = valid, 1 = invalid,
 * 2 = usage/IO error.
 *
 * Usage: node scripts/openapi/validate-spec.js [--spec <path>] [--json]
 */

const path = require('node:path');

const {
  GENERATED_SPEC_PATH,
  collectRefs,
  listOperations,
  listResponseStatuses,
  listSecuritySchemeNames,
  loadSpec,
  resolveRef,
} = require('./spec-utils');

/** @typedef {import('./spec-utils').OpenApiSpec} OpenApiSpec */
/** @typedef {{ rule: string, location: string, message: string }} Violation */

const RULES = {
  OPENAPI_VERSION: 'openapi-version',
  INFO_METADATA: 'info-metadata',
  NO_RUNTIME_SERVERS: 'no-runtime-servers',
  PATHS_PRESENT: 'paths-present',
  OPERATION_RESPONSES: 'operation-responses',
  RESOLVABLE_REFS: 'resolvable-refs',
  SECURITY_RESOLVABLE: 'security-resolvable',
};

const USAGE = `Usage: node scripts/openapi/validate-spec.js [options]

Validates the committed OpenAPI artifact (docs/openapi.base.json) is a coherent
OpenAPI 3 document: version, info metadata, server-agnostic base, documented
responses with schemas, resolvable $refs, and resolvable security schemes.

Options:
  --spec <path>  Validate a specific spec file (default: docs/openapi.base.json)
  --json         Emit machine-readable JSON results
  -h, --help     Show this help
`;

/**
 * Builds a `METHOD /path` location label for an operation.
 *
 * @param {{ method: string, path: string }} operation
 * @returns {string}
 */
function operationLocation({ method, path: routePath }) {
  return `${method.toUpperCase()} ${routePath}`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Enforces a 3.x `openapi` version declaration.
 *
 * @param {OpenApiSpec} spec
 * @returns {Violation[]}
 */
function validateVersion(spec) {
  if (typeof spec.openapi !== 'string' || !/^3\./u.test(spec.openapi)) {
    return [{
      rule: RULES.OPENAPI_VERSION,
      location: 'openapi',
      message: `must declare an OpenAPI 3.x version, got ${JSON.stringify(spec.openapi)}`,
    }];
  }

  return [];
}

/**
 * Enforces non-empty info.title and info.version.
 *
 * @param {OpenApiSpec} spec
 * @returns {Violation[]}
 */
function validateInfo(spec) {
  return ['title', 'version'].flatMap((field) => {
    if (!isNonEmptyString(spec?.info?.[field])) {
      return [{
        rule: RULES.INFO_METADATA,
        location: `info.${field}`,
        message: `info.${field} must be a non-empty string`,
      }];
    }

    return [];
  });
}

/**
 * Enforces a server-agnostic base artifact (servers are injected at serve time).
 *
 * @param {OpenApiSpec} spec
 * @returns {Violation[]}
 */
function validateNoServers(spec) {
  if ('servers' in spec) {
    return [{
      rule: RULES.NO_RUNTIME_SERVERS,
      location: 'servers',
      message: 'base artifact must not embed servers; they are injected per environment at serve time',
    }];
  }

  return [];
}

/**
 * Enforces at least one documented path.
 *
 * @param {OpenApiSpec} spec
 * @returns {Violation[]}
 */
function validatePathsPresent(spec) {
  const { paths } = spec;
  const isObject = paths !== null && typeof paths === 'object';

  if (!isObject || Object.keys(paths).length === 0) {
    return [{
      rule: RULES.PATHS_PRESENT,
      location: 'paths',
      message: 'spec must document at least one path',
    }];
  }

  return [];
}

/**
 * Enforces that every operation declares responses and every JSON response body
 * declares a schema.
 *
 * @param {OpenApiSpec} spec
 * @returns {Violation[]}
 */
function validateOperationResponses(spec) {
  return listOperations(spec).flatMap((entry) => {
    const location = operationLocation(entry);
    const statuses = listResponseStatuses(entry.operation);

    if (statuses.length === 0) {
      return [{
        rule: RULES.OPERATION_RESPONSES,
        location,
        message: 'operation must declare at least one response',
      }];
    }

    return statuses.flatMap((status) => {
      const content = entry.operation.responses[status]?.content;

      if (content === null || typeof content !== 'object') {
        return [];
      }

      return Object.entries(content)
        .filter(([, body]) => body === null || typeof body !== 'object' || !('schema' in body))
        .map(([mediaType]) => ({
          rule: RULES.OPERATION_RESPONSES,
          location: `${location} ${status} ${mediaType}`,
          message: 'response body must declare a schema',
        }));
    });
  });
}

/**
 * Enforces that every local $ref resolves within the document.
 *
 * @param {OpenApiSpec} spec
 * @returns {Violation[]}
 */
function validateRefs(spec) {
  return [...collectRefs(spec)]
    .filter((ref) => resolveRef(spec, ref) === undefined)
    .map((ref) => ({
      rule: RULES.RESOLVABLE_REFS,
      location: ref,
      message: `$ref does not resolve within the document: ${ref}`,
    }));
}

/**
 * Enforces that every security requirement names a declared security scheme.
 *
 * @param {OpenApiSpec} spec
 * @returns {Violation[]}
 */
function validateSecurity(spec) {
  const declared = new Set(listSecuritySchemeNames(spec));
  const requirementSources = [
    { location: 'security', requirements: spec.security },
    ...listOperations(spec).map((entry) => ({
      location: operationLocation(entry),
      requirements: entry.operation.security,
    })),
  ];

  return requirementSources.flatMap(({ location, requirements }) => {
    if (!Array.isArray(requirements)) {
      return [];
    }

    return requirements.flatMap((requirement) => (
      requirement !== null && typeof requirement === 'object'
        ? Object.keys(requirement).filter((scheme) => !declared.has(scheme))
        : []
    )).map((scheme) => ({
      rule: RULES.SECURITY_RESOLVABLE,
      location,
      message: `security requirement names undeclared scheme "${scheme}"`,
    }));
  });
}

const RULE_FUNCTIONS = [
  validateVersion,
  validateInfo,
  validateNoServers,
  validatePathsPresent,
  validateOperationResponses,
  validateRefs,
  validateSecurity,
];

/**
 * Runs every structural rule and returns the aggregated violations.
 *
 * @param {OpenApiSpec} spec
 * @returns {Violation[]}
 */
function validateSpec(spec) {
  return RULE_FUNCTIONS.flatMap((rule) => rule(spec));
}

/**
 * Summarizes the validated surface.
 *
 * @param {OpenApiSpec} spec
 * @returns {{ paths: number, operations: number }}
 */
function summarize(spec) {
  const paths = spec?.paths;

  return {
    paths: paths !== null && typeof paths === 'object' ? Object.keys(paths).length : 0,
    operations: listOperations(spec).length,
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
 * Writes a human-readable report grouped by rule.
 *
 * @param {{ violations: Violation[], stats: { paths: number, operations: number }, specPath: string }} report
 */
function writeReport({ violations, stats, specPath }) {
  const relativePath = path.relative(process.cwd(), specPath) || specPath;

  if (violations.length === 0) {
    process.stdout.write(
      `openapi:validate OK ${relativePath} is a coherent OpenAPI 3 document `
      + `(${stats.paths} paths, ${stats.operations} operations)\n`,
    );
    return;
  }

  process.stderr.write(
    `openapi:validate FAILED: ${violations.length} structural violation(s) in ${relativePath}\n`,
  );

  const byRule = violations.reduce((acc, violation) => {
    const list = acc.get(violation.rule) ?? [];
    list.push(violation);
    acc.set(violation.rule, list);
    return acc;
  }, /** @type {Map<string, Violation[]>} */ (new Map()));

  byRule.forEach((list, rule) => {
    process.stderr.write(`\n  [${rule}] ${list.length} issue(s):\n`);
    list.forEach((violation) => {
      process.stderr.write(`    - ${violation.location}: ${violation.message}\n`);
    });
  });

  process.stderr.write(
    '\nRegenerate the spec (npm run openapi:generate) or fix the JSDoc source.\n',
  );
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
    process.stderr.write(`openapi:validate ${/** @type {Error} */ (error).message}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  let spec;

  try {
    spec = loadSpec(args.specPath);
  } catch (error) {
    process.stderr.write(
      `openapi:validate failed to read spec at ${args.specPath}: ${/** @type {Error} */ (error).message}\n`,
    );
    return 2;
  }

  const violations = validateSpec(spec);
  const stats = summarize(spec);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, stats, violations }, null, 2)}\n`);
  } else {
    writeReport({ violations, stats, specPath: args.specPath });
  }

  return violations.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  RULES,
  main,
  parseArgs,
  summarize,
  validateInfo,
  validateNoServers,
  validateOperationResponses,
  validatePathsPresent,
  validateRefs,
  validateSecurity,
  validateSpec,
  validateVersion,
};
