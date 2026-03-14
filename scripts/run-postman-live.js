#!/usr/bin/env node

/**
 * Executes the hosted provider-validation folders from the Postman collection.
 */

const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  assertTopLevelFoldersExist,
  listTopLevelFolderNames,
  readCollection,
} = require('./postman/collection-utils');
const {
  detectAvailableProviders,
  getSelectedProviderPlans,
  resolveProviderScope,
} = require('./postman/provider-validation-scope');
const {
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
} = require('./postman/newman-reporting');
const {
  normalizeBaseUrl,
  resolveProductionDeployAuthConfig,
  waitForStableDeploy,
} = require('./run-postman-deploy');

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
const DEFAULT_BASE_URL = 'https://wcag.qcraft.com.br';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const PRIVATE_IPV4_RANGES = Object.freeze([
  [10, null],
  [127, null],
  [169, 254],
  [172, [16, 31]],
  [192, 168],
]);

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateHostname(hostname) {
  if (!hostname) {
    return false;
  }

  const normalizedHostname = hostname.toLowerCase();
  if (normalizedHostname === 'localhost' || normalizedHostname === '::1') {
    return true;
  }

  if (net.isIP(normalizedHostname) !== 4) {
    return false;
  }

  const octets = normalizedHostname.split('.').map(Number);
  return PRIVATE_IPV4_RANGES.some(([first, second]) => {
    if (octets[0] !== first) {
      return false;
    }

    if (second === null) {
      return true;
    }

    if (Array.isArray(second)) {
      return octets[1] >= second[0] && octets[1] <= second[1];
    }

    return octets[1] === second;
  });
}

/**
 * @param {string} urlString
 * @param {string} label
 */
function assertPublicHttpUrl(urlString, label) {
  const url = new URL(urlString);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${label} must use http or https`);
  }

  if (isPrivateHostname(url.hostname)) {
    throw new Error(`${label} must not target localhost or a private-network host`);
  }
}

/**
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
 * @param {string} baseUrl
 * @param {{
 *   deployValidationApiToken?: string,
 *   productionApiAuthEnabled?: 'true'|'false',
 * }} [authConfig]
 * @returns {Record<string, string>}
 */
function buildLiveProviderEnvVars(
  baseUrl,
  {
    deployValidationApiToken = '',
    productionApiAuthEnabled = 'false',
  } = {},
) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const providerValidationPageUrl = new URL('/provider-validation/page', `${normalizedBaseUrl}/`).toString();
  const providerValidationImageUrl = new URL(
    '/provider-validation/assets/a.png',
    `${normalizedBaseUrl}/`,
  ).toString();

  [
    normalizedBaseUrl,
    providerValidationPageUrl,
    providerValidationImageUrl,
  ].forEach((urlString, index) => {
    const labels = ['baseUrl', 'providerValidationPageUrl', 'providerValidationImageUrl'];
    assertPublicHttpUrl(urlString, labels[index]);
  });

  return {
    baseUrl: normalizedBaseUrl,
    deployValidationApiToken,
    expectedSwaggerServerUrl: normalizedBaseUrl,
    productionApiAuthEnabled,
    providerValidationImageUrl,
    providerValidationPageUrl,
    providerValidationAzureImageUrl: providerValidationImageUrl,
    providerValidationAzurePageUrl: providerValidationPageUrl,
    maxResponseTimeMs: '30000',
  };
}

/**
 * @param {string} baseUrl
 * @param {{
 *   allureResultsDir?: string | null,
 *   authConfig?: {
 *     deployValidationApiToken?: string,
 *     productionApiAuthEnabled?: 'true'|'false',
 *   } | null,
 *   folders: string[],
 *   label: string,
 *   providerEnvVars?: string[],
 * }} options
 * @returns {string[]}
 */
function buildLiveProviderNewmanArgs(
  baseUrl,
  {
    allureResultsDir = null,
    authConfig = null,
    folders,
    label,
    providerEnvVars = [],
  },
) {
  const folderArgs = folders.flatMap((folder) => ['--folder', folder]);
  const envVarArgs = Object.entries(buildLiveProviderEnvVars(baseUrl, authConfig ?? undefined))
    .flatMap(([key, value]) => ['--env-var', `${key}=${value}`]);

  return [
    '--no-install',
    'newman',
    'run',
    COLLECTION_PATH,
    '-e',
    ENV_PATH,
    ...envVarArgs,
    ...providerEnvVars.flatMap((envVar) => ['--env-var', envVar]),
    '--timeout-request',
    '45000',
    '--timeout-script',
    '10000',
    ...buildNewmanReporterArgs({
      label,
      reportsDir: REPORTS_DIR,
      allureResultsDir,
    }),
    ...folderArgs,
  ];
}

/**
 * @param {string} baseUrl
 * @param {{
 *   allureResultsDir?: string | null,
 *   authConfig?: {
 *     deployValidationApiToken?: string,
 *     productionApiAuthEnabled?: 'true'|'false',
 *   } | null,
 *   folders: string[],
 *   label: string,
 *   providerEnvVars?: string[],
 * }} options
 * @returns {Promise<void>}
 */
function runNewman(
  baseUrl,
  {
    allureResultsDir = null,
    authConfig = null,
    folders,
    label,
    providerEnvVars = [],
  },
) {
  const args = buildLiveProviderNewmanArgs(baseUrl, {
    allureResultsDir,
    authConfig,
    folders,
    label,
    providerEnvVars,
  });

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

      reject(new Error(`Hosted live-provider Newman run "${label}" failed with exit code ${code}`));
    });

    child.on('error', reject);
  });
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const { baseUrl } = parseArgs(process.argv.slice(2));
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const allureResultsDir = resolveAllureResultsDir(process.env, ROOT);
  const authConfig = resolveProductionDeployAuthConfig(process.env);
  const availableProviders = detectAvailableProviders(process.env);
  const providerScope = resolveProviderScope({
    requestedScope: process.env.LIVE_PROVIDER_SCOPE,
    configuredScope: process.env.LIVE_PROVIDER_SCOPE,
    configuredProviderScopes: availableProviders.configuredProviderScopes,
  });

  if (authConfig.productionApiAuthEnabled === 'true' && !authConfig.deployValidationApiToken) {
    throw new Error(
      'Hosted live-provider validation requires PRODUCTION_DEPLOY_VALIDATION_API_TOKEN '
      + 'when PRODUCTION_API_AUTH_ENABLED=true.',
    );
  }

  const providerPlans = getSelectedProviderPlans(providerScope, {
    configuredProviderScopes: availableProviders.configuredProviderScopes,
  });
  const collection = readCollection(COLLECTION_PATH);
  const availableFolders = listTopLevelFolderNames(collection);
  const selectedFolders = Array.from(
    new Set(providerPlans.map((providerPlan) => providerPlan.folderName)),
  );

  if (providerPlans.length === 0) {
    throw new Error(`Hosted live-provider mode resolved no folders for scope "${providerScope}"`);
  }

  assertTopLevelFoldersExist(
    availableFolders,
    selectedFolders,
    'hosted live-provider mode',
  );

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  if (allureResultsDir) {
    await fs.mkdir(allureResultsDir, { recursive: true });
  }

  buildLiveProviderEnvVars(normalizedBaseUrl, authConfig);
  await waitForStableDeploy(normalizedBaseUrl, authConfig);

  await providerPlans.reduce(
    (runPromise, providerPlan) => runPromise.then(() => runNewman(
      normalizedBaseUrl,
      {
        allureResultsDir,
        authConfig,
        folders: [providerPlan.folderName],
        label: `live-provider-${providerPlan.scopeKey}`,
        providerEnvVars: providerPlan.envVars,
      },
    )),
    Promise.resolve(),
  );
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  assertPublicHttpUrl,
  buildLiveProviderEnvVars,
  buildLiveProviderNewmanArgs,
  isPrivateHostname,
  parseArgs,
  runNewman,
};
