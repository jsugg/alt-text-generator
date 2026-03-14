const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const {
  buildNewmanReportPaths,
  buildNewmanReporterArgs,
} = require('./newman-reporting');
const {
  runNewmanCommand,
} = require('./newman-runner');
const {
  resolveMaxResponseTimeMs,
  resolveNewmanTimeoutRequestMs,
} = require('./harness-timeouts');
const {
  buildPublicProviderValidationFixtureUrls,
} = require('./provider-validation-public-fixtures');

const ROOT = path.resolve(__dirname, '../..');
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
  'alt-text-generator.live.postman_environment.json',
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
 * @param {string} baseUrl
 * @returns {string}
 */
function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

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
function parseBaseUrlArgs(argv) {
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
  const fixtureUrls = buildPublicProviderValidationFixtureUrls();

  assertPublicHttpUrl(normalizedBaseUrl, 'baseUrl');
  Object.entries(fixtureUrls).forEach(([key, urlString]) => {
    assertPublicHttpUrl(urlString, key);
  });

  return {
    baseUrl: normalizedBaseUrl,
    deployValidationApiToken,
    expectedSwaggerServerUrl: normalizedBaseUrl,
    productionApiAuthEnabled,
    ...fixtureUrls,
    maxResponseTimeMs: String(resolveMaxResponseTimeMs({
      providerValidationModeEnabled: true,
    })),
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
    String(resolveNewmanTimeoutRequestMs({
      providerValidationModeEnabled: true,
    })),
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
function runLiveProviderNewman(
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
  const { jsonReportPath } = buildNewmanReportPaths({
    label,
    reportsDir: REPORTS_DIR,
  });

  return runNewmanCommand({
    args: [NPX, ...args],
    collectionPath: COLLECTION_PATH,
    cwd: ROOT,
    folders,
    label,
    reportPath: jsonReportPath,
  });
}

module.exports = {
  COLLECTION_PATH,
  DEFAULT_BASE_URL,
  ENV_PATH,
  REPORTS_DIR,
  assertPublicHttpUrl,
  buildLiveProviderEnvVars,
  buildLiveProviderNewmanArgs,
  isPrivateHostname,
  normalizeBaseUrl,
  parseBaseUrlArgs,
  runLiveProviderNewman,
  ensureReportsDir: async (allureResultsDir = null) => {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    if (allureResultsDir) {
      await fs.mkdir(allureResultsDir, { recursive: true });
    }
  },
};
