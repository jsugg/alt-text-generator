/**
 * Keeps Postman dynamic variables out of the committed Postman files.
 *
 * Newman's `postman-collection` resolves `{{$...}}` tokens, some through faker.
 * This repository replaces that faker with a fail-closed stub
 * (tools/faker-stub), so the tokens must not be used at all. Non-faker tokens
 * ($guid, $timestamp, ...) are banned too, keeping one rule: no `{{$`.
 *
 * `replaceIn` is banned in any string because postman-sandbox's prebuilt
 * bootcode bundles its own faker copy, reachable only through
 * `pm.variables.replaceIn`, so a template built at run time would bypass both
 * the stub and the literal-token scan.
 */

const fs = require('node:fs');
const path = require('node:path');

/** @typedef {{ rule: string, location: string, message: string }} LintViolation */

const POLICY_RULES = {
  DYNAMIC_VARIABLES: 'no-dynamic-variables',
  TEMPLATE_REPLACE_IN: 'no-template-replace-in',
};

const DEFAULT_POSTMAN_DIR = path.resolve(__dirname, '../../postman');
const DYNAMIC_VARIABLE_PATTERN = /\{\{\s*\$/u;
const REPLACE_IN_PATTERN = /\breplaceIn\b/u;
const EXCERPT_LENGTH = 80;

/**
 * @param {string} token
 * @returns {string}
 */
function escapePointerToken(token) {
  return token.replace(/~/gu, '~0').replace(/\//gu, '~1');
}

/**
 * @param {unknown} node
 * @param {string} pointer
 * @param {(value: string, pointer: string) => void} visit
 */
function walkStrings(node, pointer, visit) {
  if (typeof node === 'string') {
    visit(node, pointer);
  } else if (Array.isArray(node)) {
    node.forEach((child, index) => walkStrings(child, `${pointer}/${index}`, visit));
  } else if (node && typeof node === 'object') {
    Object.entries(node).forEach(([key, child]) => {
      walkStrings(child, `${pointer}/${escapePointerToken(key)}`, visit);
    });
  }
}

/**
 * Reports every string in a parsed Postman document (requests, bodies,
 * headers, variables, and script `exec` lines) that uses a dynamic variable or
 * `replaceIn`. Locations are `<label>#<JSON pointer>`.
 *
 * @param {unknown} document
 * @param {string} label
 * @returns {LintViolation[]}
 */
function findDynamicVariableViolations(document, label) {
  /** @type {LintViolation[]} */
  const violations = [];

  walkStrings(document, '', (value, pointer) => {
    const location = `${label}#${pointer || '/'}`;
    const excerpt = value.trim().slice(0, EXCERPT_LENGTH);

    if (DYNAMIC_VARIABLE_PATTERN.test(value)) {
      violations.push({
        rule: POLICY_RULES.DYNAMIC_VARIABLES,
        location,
        message: `Postman dynamic variables are disabled (faker is stubbed): "${excerpt}"`,
      });
    }

    if (REPLACE_IN_PATTERN.test(value)) {
      violations.push({
        rule: POLICY_RULES.TEMPLATE_REPLACE_IN,
        location,
        message: `replaceIn reaches the sandbox's bundled faker; resolve variables with pm.variables.get: "${excerpt}"`,
      });
    }
  });

  return violations;
}

/**
 * @param {string} dir
 * @returns {string[]} absolute paths of every `.json` file under `dir`, sorted
 */
function listPostmanJsonFiles(dir = DEFAULT_POSTMAN_DIR) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string[]} files
 * @param {string} [rootDir] base for the reported file labels
 * @returns {LintViolation[]}
 */
function lintPostmanFiles(files, rootDir = process.cwd()) {
  return files.flatMap((file) => findDynamicVariableViolations(
    JSON.parse(fs.readFileSync(file, 'utf8')),
    path.relative(rootDir, file) || file,
  ));
}

module.exports = {
  DEFAULT_POSTMAN_DIR,
  POLICY_RULES,
  findDynamicVariableViolations,
  lintPostmanFiles,
  listPostmanJsonFiles,
};
