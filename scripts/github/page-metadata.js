#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} metadataPath
 * @returns {{ pagePath: string, pageUrl: string, reportKind: string }}
 */
function readPageMetadata(metadataPath) {
  const resolvedMetadataPath = path.resolve(process.cwd(), metadataPath);
  return JSON.parse(fs.readFileSync(resolvedMetadataPath, 'utf8'));
}

/**
 * @param {{
 *   metadataPath: string,
 *   pagePath: string,
 *   pageUrl: string,
 *   reportKind: string,
 * }} options
 * @returns {string}
 */
function writePageMetadata({
  metadataPath,
  pagePath,
  pageUrl,
  reportKind,
}) {
  const resolvedMetadataPath = path.resolve(process.cwd(), metadataPath);
  const metadata = {
    pagePath,
    pageUrl,
    reportKind,
  };

  fs.mkdirSync(path.dirname(resolvedMetadataPath), { recursive: true });
  fs.writeFileSync(resolvedMetadataPath, JSON.stringify(metadata, null, 2));

  return resolvedMetadataPath;
}

module.exports = {
  readPageMetadata,
  writePageMetadata,
};
