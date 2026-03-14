#!/usr/bin/env node

/**
 * Executes the production description-service validation folders from the Postman collection.
 */

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
  resolveAllureResultsDir,
} = require('./postman/newman-reporting');
const {
  COLLECTION_PATH,
  assertPublicHttpUrl,
  buildLiveProviderEnvVars,
  buildLiveProviderNewmanArgs,
  DEFAULT_BASE_URL,
  ensureReportsDir,
  isPrivateHostname,
  normalizeBaseUrl,
  parseBaseUrlArgs,
  runLiveProviderNewman,
} = require('./postman/live-provider-validation');
const {
  resolveProductionDeployAuthConfig,
  waitForStableDeploy,
} = require('./run-postman-deploy');

/**
 * @param {string[]} argv
 * @returns {{ baseUrl: string }}
 */
function parseArgs(argv) {
  return parseBaseUrlArgs(argv);
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
function runNewman(baseUrl, options) {
  return runLiveProviderNewman(baseUrl, options);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const { baseUrl } = parseArgs(process.argv.slice(2));
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const allureResultsDir = resolveAllureResultsDir(process.env, process.cwd());
  const authConfig = resolveProductionDeployAuthConfig(process.env);
  const availableProviders = detectAvailableProviders(process.env);
  const providerScope = resolveProviderScope({
    requestedScope: process.env.LIVE_PROVIDER_SCOPE,
    configuredScope: process.env.LIVE_PROVIDER_SCOPE,
    configuredProviderScopes: availableProviders.configuredProviderScopes,
  });

  if (authConfig.productionApiAuthEnabled === 'true' && !authConfig.deployValidationApiToken) {
    throw new Error(
      'Production live-provider validation requires PRODUCTION_DEPLOY_VALIDATION_API_TOKEN '
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
    throw new Error(`Production live-provider mode resolved no folders for scope "${providerScope}"`);
  }

  assertTopLevelFoldersExist(
    availableFolders,
    selectedFolders,
    'production live-provider mode',
  );

  await ensureReportsDir(allureResultsDir);

  buildLiveProviderEnvVars(normalizedBaseUrl, authConfig);
  assertPublicHttpUrl(normalizedBaseUrl, 'baseUrl');
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
  DEFAULT_BASE_URL,
  assertPublicHttpUrl,
  buildLiveProviderEnvVars,
  buildLiveProviderNewmanArgs,
  isPrivateHostname,
  normalizeBaseUrl,
  parseArgs,
  runNewman,
};
