#!/usr/bin/env node

/**
 * Executes the hosted deploy verification folder from the Postman collection.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  assertTopLevelFoldersExist,
  listTopLevelFolderNames,
  readCollection,
} = require('./postman/collection-utils');

const ROOT = path.resolve(__dirname, '..');
const COLLECTION_PATH = path.join(
  ROOT,
  'postman',
  'collections',
  'alt-text-generator.postman_collection.json',
);
const ENV_PATH = path.join(
  ROOT,
  'postman',
  'environments',
  'alt-text-generator.deploy.postman_environment.json',
);
const REPORTS_DIR = path.join(ROOT, 'reports', 'newman');
const DEPLOY_FOLDER = '95 Deploy Verification';
const DEFAULT_BASE_URL = 'https://wcag.qcraft.com.br';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/**
 * Normalizes a base URL for env-var reuse.
 *
 * @param {string} baseUrl
 * @returns {string}
 */
function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{ baseUrl: string }}
 */
function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const separatorIndex = token.indexOf('=');
    const key = separatorIndex >= 0 ? token.slice(2, separatorIndex) : token.slice(2);
    const rawValue = separatorIndex >= 0 ? token.slice(separatorIndex + 1) : argv[index + 1];

    if (separatorIndex < 0) {
      index += 1;
    }

    if (rawValue === undefined) {
      throw new Error(`Missing value for --${key}`);
    }

    switch (key) {
      case 'base-url':
        args.baseUrl = rawValue;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  return args;
}

/**
 * Runs the deploy Newman folder.
 *
 * @param {string} baseUrl
 * @returns {Promise<void>}
 */
function runNewman(baseUrl) {
  const args = [
    '--no-install',
    'newman',
    'run',
    COLLECTION_PATH,
    '-e',
    ENV_PATH,
    '--env-var',
    `baseUrl=${baseUrl}`,
    '--env-var',
    `expectedSwaggerServerUrl=${baseUrl}`,
    '--timeout-request',
    '45000',
    '--timeout-script',
    '10000',
    '-r',
    'cli,json,junit',
    '--reporter-json-export',
    path.join(REPORTS_DIR, 'deploy.json'),
    '--reporter-junit-export',
    path.join(REPORTS_DIR, 'deploy.xml'),
    '--folder',
    DEPLOY_FOLDER,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(NPX, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Deploy Newman run failed with exit code ${code}`));
    });

    child.on('error', reject);
  });
}

/**
 * Entry point.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const { baseUrl } = parseArgs(process.argv.slice(2));
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const collection = readCollection(COLLECTION_PATH);
  const availableFolders = listTopLevelFolderNames(collection);

  assertTopLevelFoldersExist(
    availableFolders,
    [DEPLOY_FOLDER],
    'deploy mode',
  );

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await runNewman(normalizedBaseUrl);
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  normalizeBaseUrl,
  parseArgs,
};
