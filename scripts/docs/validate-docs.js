#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

/**
 * @typedef {{ file: string, line: number, message: string }} DocViolation
 */

/**
 * Enumerates the Markdown files git tracks under `rootDir`.
 *
 * This deliberately asks git rather than walking the filesystem. A walk with a
 * hardcoded skip list saw whatever happened to be on the developer's disk, so
 * the gate's verdict depended on untracked local state: it validated scratch
 * notes under `.local/`, and a note saved with CRLF failed the gate locally
 * while CI — which only ever has the tracked files — passed. Asking git makes
 * the local result and the clean-checkout result the same set by construction.
 *
 * @param {string} [rootDir]
 * @returns {string[]}
 */
function listMarkdownFiles(rootDir = ROOT) {
  const stdout = execFileSync('git', ['-C', rootDir, 'ls-files', '-z', '--', '*.md'], {
    encoding: 'utf8',
  });

  return stdout
    .split('\0')
    .filter(Boolean)
    .map((relativePath) => path.join(rootDir, relativePath))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string} filePath
 * @param {string} [rootDir]
 * @returns {DocViolation[]}
 */
function validateMarkdownFile(filePath, rootDir = ROOT) {
  const relativePath = path.relative(rootDir, filePath) || filePath;
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  if (content.trim().length === 0) {
    violations.push({
      file: relativePath,
      line: 1,
      message: 'Markdown file must not be empty',
    });
  }

  if (content.includes('\r')) {
    violations.push({
      file: relativePath,
      line: 1,
      message: 'Markdown file must use LF line endings',
    });
  }

  content.split('\n').forEach((line, index) => {
    if (/^(<<<<<<<|=======|>>>>>>>)/u.test(line)) {
      violations.push({
        file: relativePath,
        line: index + 1,
        message: 'Markdown file contains a merge-conflict marker',
      });
    }
  });

  return violations;
}

function validateDocs({ rootDir = ROOT } = {}) {
  const files = listMarkdownFiles(rootDir);

  return {
    files: files.map((filePath) => path.relative(rootDir, filePath) || filePath),
    violations: files.flatMap((filePath) => validateMarkdownFile(filePath, rootDir)),
  };
}

/** @param {{ files: string[], violations: DocViolation[] }} report */
function writeReport({ files, violations }) {
  if (violations.length === 0) {
    process.stdout.write(`docs:validate OK (${files.length} Markdown files)\n`);
    return;
  }

  process.stderr.write(`docs:validate FAILED: ${violations.length} violation(s)\n`);
  violations.forEach((violation) => {
    process.stderr.write(`  - ${violation.file}:${violation.line} ${violation.message}\n`);
  });
}

/**
 * @param {string[]} argv
 * @returns {{ json: boolean, rootDir: string }}
 */
function parseArgs(argv) {
  const args = { json: false, rootDir: ROOT };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--root') {
      index += 1;

      if (typeof argv[index] !== 'string') {
        throw new Error('--root requires a directory argument');
      }

      args.rootDir = path.resolve(argv[index]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function main(argv = process.argv.slice(2)) {
  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`docs:validate ${error instanceof Error ? error.message : error}\n`);
    return 2;
  }

  const result = validateDocs({ rootDir: args.rootDir });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    writeReport(result);
  }

  return result.violations.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  listMarkdownFiles,
  main,
  parseArgs,
  validateDocs,
  validateMarkdownFile,
};
