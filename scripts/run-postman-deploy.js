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
  'alt-text-generator.production.postman_environment.json',
);
const REPORTS_DIR = path.join(ROOT, 'reports', 'newman');
const PUBLIC_DEPLOY_FOLDER = '95 Deploy Verification';
const PROTECTED_DEPLOY_FOLDER = '96 Deploy Protected Verification';
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
 * Normalizes a string boolean flag.
 *
 * @param {string|undefined|null} value
 * @param {{ label?: string, fallback?: 'true'|'false' }} [options]
 * @returns {'true'|'false'}
 */
function normalizeBooleanFlag(
  value,
  { label = 'boolean flag', fallback = 'false' } = {},
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string boolean`);
  }

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue !== 'true' && normalizedValue !== 'false') {
    throw new Error(`${label} must be either "true" or "false"`);
  }

  return normalizedValue;
}

/**
 * Resolves the production deploy-auth configuration from the environment.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{
 *   deployValidationApiToken: string,
 *   productionApiAuthEnabled: 'true'|'false',
 *   protectedVerificationEnabled: boolean,
 *   protectedVerificationSkipReason: string|null,
 * }}
 */
function resolveProductionDeployAuthConfig(env = process.env) {
  const productionApiAuthEnabled = normalizeBooleanFlag(
    env.PRODUCTION_API_AUTH_ENABLED,
    { label: 'PRODUCTION_API_AUTH_ENABLED' },
  );
  const deployValidationApiToken = typeof env.PRODUCTION_DEPLOY_VALIDATION_API_TOKEN === 'string'
    ? env.PRODUCTION_DEPLOY_VALIDATION_API_TOKEN.trim()
    : '';
  const protectedVerificationEnabled = productionApiAuthEnabled === 'false'
    || deployValidationApiToken.length > 0;
  const protectedVerificationSkipReason = protectedVerificationEnabled
    ? null
    : 'Skipping 96 Deploy Protected Verification because '
      + 'PRODUCTION_API_AUTH_ENABLED=true but PRODUCTION_DEPLOY_VALIDATION_API_TOKEN is not set. '
      + 'Protected deploy checks require Render API_AUTH_ENABLED=true and '
      + 'API_AUTH_TOKENS to include the same token.';

  return {
    productionApiAuthEnabled,
    deployValidationApiToken,
    protectedVerificationEnabled,
    protectedVerificationSkipReason,
  };
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
 * @param {{
 *   deployValidationApiToken: string,
 *   folders: string[],
 *   productionApiAuthEnabled: 'true'|'false',
 * }} options
 * @returns {Promise<void>}
 */
function runNewman(
  baseUrl,
  {
    deployValidationApiToken,
    folders,
    productionApiAuthEnabled,
  },
) {
  const folderArgs = folders.flatMap((folder) => ['--folder', folder]);
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
    '--env-var',
    `productionApiAuthEnabled=${productionApiAuthEnabled}`,
    '--env-var',
    `deployValidationApiToken=${deployValidationApiToken}`,
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
    ...folderArgs,
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
  const authConfig = resolveProductionDeployAuthConfig(process.env);
  const collection = readCollection(COLLECTION_PATH);
  const availableFolders = listTopLevelFolderNames(collection);
  const selectedFolders = [PUBLIC_DEPLOY_FOLDER];

  if (authConfig.protectedVerificationEnabled) {
    selectedFolders.push(PROTECTED_DEPLOY_FOLDER);
  } else {
    process.stdout.write(`${authConfig.protectedVerificationSkipReason}\n`);
  }

  assertTopLevelFoldersExist(
    availableFolders,
    selectedFolders,
    'deploy mode',
  );

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await runNewman(normalizedBaseUrl, {
    deployValidationApiToken: authConfig.deployValidationApiToken,
    folders: selectedFolders,
    productionApiAuthEnabled: authConfig.productionApiAuthEnabled,
  });
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
  normalizeBooleanFlag,
  parseArgs,
  resolveProductionDeployAuthConfig,
};
