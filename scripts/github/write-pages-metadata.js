#!/usr/bin/env node

const { writePageMetadata } = require('./page-metadata');

/**
 * @param {string[]} argv
 * @returns {{
 *   metadataPath: string,
 *   pagePath: string,
 *   pageUrl: string,
 *   reportKind: string,
 * }}
 */
function parseArgs(argv) {
  let metadataPath = null;
  let pagePath = null;
  let pageUrl = null;
  let reportKind = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--metadata-path') {
      metadataPath = argv[index + 1] || null;
      index += 1;
    } else if (token === '--page-path') {
      pagePath = argv[index + 1] || '';
      index += 1;
    } else if (token === '--page-url') {
      pageUrl = argv[index + 1] || '';
      index += 1;
    } else if (token === '--report-kind') {
      reportKind = argv[index + 1] || '';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!metadataPath) {
    throw new Error('Missing required argument: --metadata-path <path>');
  }

  if (pagePath === null) {
    throw new Error('Missing required argument: --page-path <path>');
  }

  if (pageUrl === null) {
    throw new Error('Missing required argument: --page-url <url>');
  }

  if (!reportKind) {
    throw new Error('Missing required argument: --report-kind <kind>');
  }

  return {
    metadataPath,
    pagePath,
    pageUrl,
    reportKind,
  };
}

if (require.main === module) {
  writePageMetadata(parseArgs(process.argv.slice(2)));
}

module.exports = {
  parseArgs,
};
