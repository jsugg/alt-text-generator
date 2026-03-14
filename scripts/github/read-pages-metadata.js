#!/usr/bin/env node

const fs = require('node:fs');

const { readPageMetadata } = require('./page-metadata');

/**
 * @param {string[]} argv
 * @returns {{
 *   githubOutput: string,
 *   metadataPath: string,
 * }}
 */
function parseArgs(argv) {
  let githubOutput = null;
  let metadataPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--github-output') {
      githubOutput = argv[index + 1] || null;
      index += 1;
    } else if (token === '--metadata-path') {
      metadataPath = argv[index + 1] || null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!githubOutput) {
    throw new Error('Missing required argument: --github-output <path>');
  }

  if (!metadataPath) {
    throw new Error('Missing required argument: --metadata-path <path>');
  }

  return {
    githubOutput,
    metadataPath,
  };
}

/**
 * @param {{
 *   githubOutput: string,
 *   metadataPath: string,
 * }} options
 * @returns {{ pagePath: string, pageUrl: string, reportKind: string }}
 */
function writeGitHubOutputs({
  githubOutput,
  metadataPath,
}) {
  const metadata = readPageMetadata(metadataPath);

  fs.appendFileSync(githubOutput, `page_path=${metadata.pagePath}\n`);
  fs.appendFileSync(githubOutput, `page_url=${metadata.pageUrl}\n`);
  fs.appendFileSync(githubOutput, `report_kind=${metadata.reportKind}\n`);

  return metadata;
}

if (require.main === module) {
  writeGitHubOutputs(parseArgs(process.argv.slice(2)));
}

module.exports = {
  parseArgs,
  writeGitHubOutputs,
};
