#!/usr/bin/env node

// Single source of truth for the docs-only CI classification.
//
// `docs_only` lets a pull request skip lint, OpenAPI, typecheck, the unit
// matrix, the full Jest lane, and Newman — six required checks that then report
// themselves satisfied by `docs:validate`. That is only honest for files
// `docs:validate` can actually inspect, so the predicate must stay narrow:
// anything executable, generated, or contract-bearing has to run the real gates.
//
// `docs/openapi.base.json` is the case that motivated extracting this. It lived
// under `docs/`, so a prefix match classified the published HTTP contract as
// documentation and waved it through every gate — while `docs:validate` filters
// to Markdown and therefore validated nothing about the change at all. Matching
// on the `.md` extension (plus LICENSE and image assets) keeps `docs/*.md`
// skippable without handing that exemption to whatever else lands under `docs/`.
//
// This module is imported by .github/workflows/ci.yml and codeql.yml so the two
// cannot drift apart. It gates every required check, so it is unit-tested:
// tests/unit/scripts/ci/classifyChangedPaths.test.js.

const fs = require('node:fs');

/**
 * True when a path is documentation that `docs:validate` can meaningfully check.
 *
 * Deliberately extension-based rather than directory-based — see the note above.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isDocsPath(filePath) {
  return (
    filePath === 'LICENSE'
    || filePath.endsWith('.md')
    || filePath.startsWith('.github/assets/')
  );
}

/**
 * @param {string[]} changedFiles
 * @returns {{ docsChanged: boolean, docsOnly: boolean }}
 */
function classifyChangedPaths(changedFiles) {
  // An empty list is never docs-only: with no evidence of what changed, the
  // safe answer is to run the gates rather than skip them.
  return {
    docsChanged: changedFiles.some(isDocsPath),
    docsOnly: changedFiles.length > 0 && changedFiles.every(isDocsPath),
  };
}

/**
 * @param {string} contents
 * @returns {string[]}
 */
function parseChangedFiles(contents) {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} argv
 * @returns {{ input: string, json: boolean }}
 */
function parseArgs(argv) {
  const args = { input: 'changed-files.txt', json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--input') {
      index += 1;

      if (typeof argv[index] !== 'string') {
        throw new Error('--input requires a file argument');
      }

      args.input = argv[index];
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
    process.stderr.write(`classify-changed-paths ${error instanceof Error ? error.message : error}\n`);
    return 2;
  }

  const changedFiles = parseChangedFiles(fs.readFileSync(args.input, 'utf8'));
  const { docsChanged, docsOnly } = classifyChangedPaths(changedFiles);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ changedFiles, docsChanged, docsOnly }, null, 2)}\n`);
  } else {
    process.stdout.write(`docs_changed=${docsChanged} docs_only=${docsOnly} (${changedFiles.length} changed file(s))\n`);
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `docs_changed=${docsChanged}\ndocs_only=${docsOnly}\n`,
    );
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  classifyChangedPaths,
  isDocsPath,
  main,
  parseArgs,
  parseChangedFiles,
};
