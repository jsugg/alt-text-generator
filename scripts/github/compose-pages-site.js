#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const PRESERVED_ROOT_ENTRIES = ['pr'];

/**
 * @param {string[]} argv
 * @returns {{
 *   existingSiteDir: string,
 *   outputDir: string,
 *   publishPath: string,
 *   reportDir: string,
 * }}
 */
function parseArgs(argv) {
  let existingSiteDir = null;
  let outputDir = null;
  let publishPath = null;
  let reportDir = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--existing-site-dir') {
      existingSiteDir = argv[index + 1] || null;
      index += 1;
    } else if (token === '--output-dir') {
      outputDir = argv[index + 1] || null;
      index += 1;
    } else if (token === '--publish-path') {
      publishPath = argv[index + 1] || '';
      index += 1;
    } else if (token === '--report-dir') {
      reportDir = argv[index + 1] || null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!existingSiteDir) {
    throw new Error('Missing required argument: --existing-site-dir <path>');
  }

  if (!outputDir) {
    throw new Error('Missing required argument: --output-dir <path>');
  }

  if (!reportDir) {
    throw new Error('Missing required argument: --report-dir <path>');
  }

  return {
    existingSiteDir: path.resolve(process.cwd(), existingSiteDir),
    outputDir: path.resolve(process.cwd(), outputDir),
    publishPath,
    reportDir: path.resolve(process.cwd(), reportDir),
  };
}

/**
 * @param {string} publishPath
 * @returns {string}
 */
function normalizePublishPath(publishPath) {
  const normalizedPath = publishPath.replace(/^\/+|\/+$/gu, '');

  if (!normalizedPath) {
    return '';
  }

  const segments = normalizedPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid publish path: ${publishPath}`);
  }

  return segments.join('/');
}

/**
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} sourceDir
 * @param {string} destinationDir
 * @returns {Promise<void>}
 */
async function copyDirectory(sourceDir, destinationDir) {
  if (!(await pathExists(sourceDir))) {
    return;
  }

  await fs.mkdir(path.dirname(destinationDir), { recursive: true });
  await fs.cp(sourceDir, destinationDir, {
    force: true,
    recursive: true,
  });
}

/**
 * @param {{
 *   destinationDir: string,
 *   entryNames: string[],
 *   sourceDir: string,
 * }} options
 * @returns {Promise<void>}
 */
async function copyNamedEntries({
  destinationDir,
  entryNames,
  sourceDir,
}) {
  await Promise.all(entryNames.map((entryName) => copyDirectory(
    path.join(sourceDir, entryName),
    path.join(destinationDir, entryName),
  )));
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

/**
 * @param {string} siteDir
 * @returns {Promise<string[]>}
 */
async function listPublishedPrDirectories(siteDir) {
  const prRootDir = path.join(siteDir, 'pr');

  if (!(await pathExists(prRootDir))) {
    return [];
  }

  const entries = await fs.readdir(prRootDir, { withFileTypes: true });
  const publishedPrDirectories = await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory()) {
      return null;
    }

    const reportIndexPath = path.join(prRootDir, entry.name, 'index.html');
    if (!(await pathExists(reportIndexPath))) {
      return null;
    }

    return entry.name;
  }));

  return publishedPrDirectories
    .filter(Boolean)
    .sort((left, right) => Number(right) - Number(left));
}

/**
 * @param {string} siteDir
 * @returns {Promise<void>}
 */
async function writePrIndex(siteDir) {
  const publishedPrDirectories = await listPublishedPrDirectories(siteDir);
  const prRootDir = path.join(siteDir, 'pr');

  if (publishedPrDirectories.length === 0) {
    await fs.rm(path.join(prRootDir, 'index.html'), {
      force: true,
    });
    return;
  }

  await fs.mkdir(prRootDir, { recursive: true });
  const links = publishedPrDirectories
    .map((pullRequestNumber) => (
      `<li><a href="./${escapeHtml(pullRequestNumber)}/">PR #${escapeHtml(pullRequestNumber)}</a></li>`
    ))
    .join('\n');

  await fs.writeFile(path.join(prRootDir, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Alt Text Generator PR Allure Reports</title>
  </head>
  <body>
    <main>
      <h1>Alt Text Generator PR Allure Reports</h1>
      <p>Published pull request reports with preserved per-PR history.</p>
      <ul>
${links}
      </ul>
    </main>
  </body>
</html>
`, 'utf8');
}

/**
 * @param {{
 *   outputDir: string,
 *   publishPath: string,
 * }} options
 * @returns {Promise<void>}
 */
async function writeFallbackRootIndex({
  outputDir,
  publishPath,
}) {
  const rootIndexPath = path.join(outputDir, 'index.html');

  if (await pathExists(rootIndexPath)) {
    return;
  }

  const destinationPath = publishPath ? `./${publishPath}/` : './';
  await fs.writeFile(rootIndexPath, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=${escapeHtml(destinationPath)}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Alt Text Generator Allure Reports</title>
  </head>
  <body>
    <main>
      <h1>Alt Text Generator Allure Reports</h1>
      <p>The main report is not available in this Pages snapshot.</p>
      <p><a href="${escapeHtml(destinationPath)}">Open the published report</a></p>
    </main>
  </body>
</html>
`, 'utf8');
}

/**
 * @param {{
 *   existingSiteDir: string,
 *   outputDir: string,
 *   publishPath: string,
 *   reportDir: string,
 * }} options
 * @returns {Promise<{
 *   outputDir: string,
 *   publishPath: string,
 *   targetDir: string,
 * }>}
 */
async function composePagesSite({
  existingSiteDir,
  outputDir,
  publishPath,
  reportDir,
}) {
  const normalizedPublishPath = normalizePublishPath(publishPath);
  const targetDir = normalizedPublishPath
    ? path.join(outputDir, normalizedPublishPath)
    : outputDir;

  await fs.rm(outputDir, {
    force: true,
    recursive: true,
  });
  await fs.mkdir(outputDir, { recursive: true });

  if (normalizedPublishPath) {
    await copyDirectory(existingSiteDir, outputDir);
    await fs.rm(targetDir, {
      force: true,
      recursive: true,
    });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await copyDirectory(reportDir, targetDir);
  } else {
    await copyDirectory(reportDir, outputDir);
    await copyNamedEntries({
      destinationDir: outputDir,
      entryNames: PRESERVED_ROOT_ENTRIES,
      sourceDir: existingSiteDir,
    });
  }

  await fs.writeFile(path.join(outputDir, '.nojekyll'), '', 'utf8');
  if (normalizedPublishPath) {
    await writeFallbackRootIndex({
      outputDir,
      publishPath: normalizedPublishPath,
    });
  }
  await writePrIndex(outputDir);

  return {
    outputDir,
    publishPath: normalizedPublishPath,
    targetDir,
  };
}

if (require.main === module) {
  composePagesSite(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  composePagesSite,
  escapeHtml,
  listPublishedPrDirectories,
  normalizePublishPath,
  parseArgs,
  pathExists,
  writeFallbackRootIndex,
  writePrIndex,
};
