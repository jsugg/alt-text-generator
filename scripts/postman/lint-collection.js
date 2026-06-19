#!/usr/bin/env node

/**
 * Static policy linter for the committed Postman collection.
 *
 * Promotes the contract-harness standards that were previously only enforced at
 * runtime (and scattered across collection-utils consumers) into a single
 * standalone gate that runs before any server starts. It validates:
 *
 *   - deterministic-folder-names  : two-digit ordered, unique, ascending prefixes
 *   - deterministic-request-names : non-empty, trimmed, unique within their folder
 *   - exact-status-expectations   : every request pins an exact status
 *   - error-contract-assertions   : 4xx/5xx requests assert the public error body
 *   - forbidden-live-urls         : request URLs target Postman variables, never
 *                                   a literal/live host
 *
 * Every violation reports the affected `folder > request` so failures point at
 * the exact item to fix. Exit code 0 = clean, 1 = violations, 2 = usage/IO error.
 *
 * Usage: node scripts/postman/lint-collection.js [--collection <path>] [--json]
 */

const path = require('node:path');

const {
  getExpectedStatusCode,
  getRequestTestScript,
  hasSpecificStatusExpectation,
  listRequestItems,
  listTopLevelFolderNames,
  readCollection,
} = require('./collection-utils');

const DEFAULT_COLLECTION_PATH = path.resolve(
  __dirname,
  '../../postman/collections/alt-text-generator.postman_collection.json',
);

const RULES = {
  FOLDER_NAMES: 'deterministic-folder-names',
  REQUEST_NAMES: 'deterministic-request-names',
  STATUS_EXPECTATIONS: 'exact-status-expectations',
  ERROR_CONTRACT: 'error-contract-assertions',
  FORBIDDEN_URLS: 'forbidden-live-urls',
};

// Top-level folders must read like "10 Scraper Contract": a two-digit ordering
// prefix plus a non-blank label, which keeps Newman's run order deterministic.
const FOLDER_NAME_PATTERN = /^(\d{2}) \S.*$/u;

// Request URLs must address the service through a Postman variable host so the
// same requests run against ephemeral local servers and live deployments alike.
// The host token may be followed by a literal path or a second path variable
// (async job polling captures a server-provided statusUrl), so only the leading
// host token is constrained here.
const STARTS_WITH_VARIABLE_PATTERN = /^\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/u;

// A literal http(s):// scheme that is not immediately a Postman variable means a
// host was hardcoded into the request.
const LITERAL_SCHEME_PATTERN = /https?:\/\/(?!\{\{)/iu;

// Live/provider/cloud hosts that must never appear in a request URL, even if a
// variable is also present elsewhere in the raw string.
const FORBIDDEN_URL_TOKENS = [
  'replicate.com',
  'wcag.qcraft',
  'qcraft.com',
  'qcraft.dev',
  'amazonaws.com',
  'blob.core.windows.net',
  'cognitiveservices.azure.com',
  'openai.azure.com',
  '169.254.169.254',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
];

const USAGE = `Usage: node scripts/postman/lint-collection.js [options]

Validates the committed Postman collection against contract-harness policy
before any server starts: deterministic folder/request names, exact status
expectations, error/auth contract assertions, and forbidden live URLs.

Options:
  --collection <path>  Lint a specific collection file (default: committed collection)
  --json               Emit machine-readable JSON results
  -h, --help           Show this help
`;

/**
 * Builds a `folder > request` location label for a request item.
 *
 * @param {string} folder
 * @param {object} item
 * @returns {string}
 */
function requestLocation(folder, item) {
  return `${folder} > ${item.name}`;
}

/**
 * Extracts the raw URL string and dotted host of a request item.
 *
 * @param {object} item
 * @returns {{ raw: string, host: string }}
 */
function getRequestUrl(item) {
  const url = item?.request?.url;

  if (typeof url === 'string') {
    return { raw: url, host: '' };
  }

  const raw = typeof url?.raw === 'string' ? url.raw : '';
  const host = Array.isArray(url?.host) ? url.host.join('.') : '';

  return { raw, host };
}

/**
 * Enforces deterministic, uniquely ordered top-level folder names.
 *
 * @param {object} collection
 * @returns {{ rule: string, location: string, message: string }[]}
 */
function lintFolderNames(collection) {
  const folders = listTopLevelFolderNames(collection);
  const nameCounts = new Map();
  const prefixOwners = new Map();
  const violations = [];
  let previousPrefix = -1;

  folders.forEach((name) => {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);

    const match = name.match(FOLDER_NAME_PATTERN);

    if (!match) {
      violations.push({
        rule: RULES.FOLDER_NAMES,
        location: name,
        message: `folder name must start with a two-digit order prefix (e.g. "10 Example"), got "${name}"`,
      });
      return;
    }

    const [, rawPrefix] = match;
    const prefix = Number.parseInt(rawPrefix, 10);

    if (prefixOwners.has(rawPrefix)) {
      violations.push({
        rule: RULES.FOLDER_NAMES,
        location: name,
        message: `duplicate folder order prefix "${rawPrefix}" (already used by "${prefixOwners.get(rawPrefix)}")`,
      });
    } else {
      prefixOwners.set(rawPrefix, name);
    }

    if (prefix < previousPrefix) {
      violations.push({
        rule: RULES.FOLDER_NAMES,
        location: name,
        message: `folder order prefix "${rawPrefix}" breaks ascending order`,
      });
    }

    previousPrefix = prefix;
  });

  nameCounts.forEach((count, name) => {
    if (count > 1) {
      violations.push({
        rule: RULES.FOLDER_NAMES,
        location: name,
        message: `duplicate top-level folder name (appears ${count} times)`,
      });
    }
  });

  return violations;
}

/**
 * Enforces non-empty, trimmed, folder-unique request names.
 *
 * @param {object} collection
 * @returns {{ rule: string, location: string, message: string }[]}
 */
function lintRequestNames(collection) {
  const namesByFolder = listRequestItems(collection).reduce((acc, { item, topLevelFolderName }) => {
    const names = acc.get(topLevelFolderName) ?? [];
    names.push(item.name);
    acc.set(topLevelFolderName, names);
    return acc;
  }, new Map());

  const violations = [];

  namesByFolder.forEach((names, folder) => {
    const seen = new Map();

    names.forEach((name) => {
      if (typeof name !== 'string' || name.trim() === '') {
        violations.push({
          rule: RULES.REQUEST_NAMES,
          location: folder,
          message: 'request name must be a non-empty string',
        });
        return;
      }

      if (name !== name.trim()) {
        violations.push({
          rule: RULES.REQUEST_NAMES,
          location: `${folder} > ${name}`,
          message: 'request name has leading or trailing whitespace',
        });
      }

      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);

      if (count === 2) {
        violations.push({
          rule: RULES.REQUEST_NAMES,
          location: `${folder} > ${name}`,
          message: 'duplicate request name within folder',
        });
      }
    });
  });

  return violations;
}

/**
 * Enforces an exact status expectation on every request.
 *
 * @param {object} collection
 * @returns {{ rule: string, location: string, message: string }[]}
 */
function lintStatusExpectations(collection) {
  return listRequestItems(collection)
    .filter(({ item }) => !hasSpecificStatusExpectation(item))
    .map(({ item, topLevelFolderName }) => ({
      rule: RULES.STATUS_EXPECTATIONS,
      location: requestLocation(topLevelFolderName, item),
      message: 'missing exact status expectation '
        + '(add an X-Expected-Status-Code header or pm.response.to.have.status(...))',
    }));
}

/**
 * Enforces public error-contract assertions on auth/error (>= 400) responses.
 *
 * @param {object} collection
 * @returns {{ rule: string, location: string, message: string }[]}
 */
function lintErrorContract(collection) {
  return listRequestItems(collection).reduce((violations, { item, topLevelFolderName }) => {
    const status = getExpectedStatusCode(item);

    if (status === null || status < 400) {
      return violations;
    }

    const assertsErrorBody = getRequestTestScript(item)
      .split('\n')
      .some((line) => line.includes('pm.expect(') && /\berror\b/u.test(line));

    if (!assertsErrorBody) {
      violations.push({
        rule: RULES.ERROR_CONTRACT,
        location: requestLocation(topLevelFolderName, item),
        message: `${status} response must assert the public error contract `
          + '(e.g. pm.expect(body.error)...)',
      });
    }

    return violations;
  }, []);
}

/**
 * Enforces that request URLs target Postman variables, never literal/live hosts.
 *
 * @param {object} collection
 * @returns {{ rule: string, location: string, message: string }[]}
 */
function lintForbiddenUrls(collection) {
  return listRequestItems(collection).reduce((violations, { item, topLevelFolderName }) => {
    const location = requestLocation(topLevelFolderName, item);
    const { raw, host } = getRequestUrl(item);
    const subject = raw || host;

    if (!STARTS_WITH_VARIABLE_PATTERN.test(subject)) {
      violations.push({
        rule: RULES.FORBIDDEN_URLS,
        location,
        message: `request URL host must be a Postman variable (e.g. {{baseUrl}}), got "${subject || '(empty)'}"`,
      });
    }

    if (LITERAL_SCHEME_PATTERN.test(subject)) {
      violations.push({
        rule: RULES.FORBIDDEN_URLS,
        location,
        message: `request URL must not hardcode an http(s) host: "${subject}"`,
      });
    }

    const forbiddenToken = FORBIDDEN_URL_TOKENS.find((token) => subject.toLowerCase().includes(token));

    if (forbiddenToken) {
      violations.push({
        rule: RULES.FORBIDDEN_URLS,
        location,
        message: `request URL contains forbidden live host token "${forbiddenToken}": "${raw}"`,
      });
    }

    return violations;
  }, []);
}

const RULE_FUNCTIONS = [
  lintFolderNames,
  lintRequestNames,
  lintStatusExpectations,
  lintErrorContract,
  lintForbiddenUrls,
];

/**
 * Runs every policy rule and returns the aggregated violations.
 *
 * @param {object} collection
 * @returns {{ rule: string, location: string, message: string }[]}
 */
function lintCollection(collection) {
  return RULE_FUNCTIONS.flatMap((rule) => rule(collection));
}

/**
 * Summarizes the scope that was linted.
 *
 * @param {object} collection
 * @returns {{ folders: number, requests: number }}
 */
function summarize(collection) {
  return {
    folders: listTopLevelFolderNames(collection).length,
    requests: listRequestItems(collection).length,
  };
}

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{ collectionPath: string, json: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const args = { collectionPath: DEFAULT_COLLECTION_PATH, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--collection') {
      i += 1;

      if (typeof argv[i] !== 'string') {
        throw new Error('--collection requires a path argument');
      }

      args.collectionPath = path.resolve(argv[i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

/**
 * Writes a human-readable report and points each violation at its folder/request.
 *
 * @param {{ violations: object[], stats: object, collectionPath: string }} report
 */
function writeReport({ violations, stats, collectionPath }) {
  const relativePath = path.relative(process.cwd(), collectionPath) || collectionPath;

  if (violations.length === 0) {
    process.stdout.write(
      `postman:lint OK ${relativePath} passed policy checks `
      + `(${stats.folders} folders, ${stats.requests} requests)\n`,
    );
    return;
  }

  process.stderr.write(
    `postman:lint FAILED: ${violations.length} policy violation(s) in ${relativePath}\n`,
  );

  const byRule = violations.reduce((acc, violation) => {
    const list = acc.get(violation.rule) ?? [];
    list.push(violation);
    acc.set(violation.rule, list);
    return acc;
  }, new Map());

  byRule.forEach((list, rule) => {
    process.stderr.write(`\n  [${rule}] ${list.length} issue(s):\n`);
    list.forEach((violation) => {
      process.stderr.write(`    - ${violation.location}: ${violation.message}\n`);
    });
  });

  process.stderr.write(
    '\nFix the collection or update policy in scripts/postman/lint-collection.js.\n',
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
    process.stderr.write(`postman:lint ${error.message}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  let collection;

  try {
    collection = readCollection(args.collectionPath);
  } catch (error) {
    process.stderr.write(
      `postman:lint failed to read collection at ${args.collectionPath}: ${error.message}\n`,
    );
    return 2;
  }

  const violations = lintCollection(collection);
  const stats = summarize(collection);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, stats, violations }, null, 2)}\n`);
  } else {
    writeReport({ violations, stats, collectionPath: args.collectionPath });
  }

  return violations.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  DEFAULT_COLLECTION_PATH,
  FORBIDDEN_URL_TOKENS,
  RULES,
  getRequestUrl,
  lintCollection,
  lintErrorContract,
  lintFolderNames,
  lintForbiddenUrls,
  lintRequestNames,
  lintStatusExpectations,
  main,
  parseArgs,
  summarize,
};
