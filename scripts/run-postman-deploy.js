#!/usr/bin/env node

/**
 * Executes the post-deploy verification folders from the Postman collection.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  assertTopLevelFoldersExist,
  listTopLevelFolderNames,
  readCollection,
} = require('./postman/collection-utils');
const {
  LOW_COST_PROVIDER_VALIDATION_SCOPES,
  detectAvailableProviders,
  getSelectedProviderPlans,
  resolveProviderScope,
} = require('./postman/provider-validation-scope');
const {
  buildNewmanReportPaths,
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
} = require('./postman/newman-reporting');
const {
  runNewmanCommand,
} = require('./postman/newman-runner');
const {
  assertProviderValidationFixturesReachable,
} = require('./postman/provider-validation-fixture-probe');
const {
  buildLiveProviderEnvVars,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  runLiveProviderNewman,
} = require('./postman/live-provider-validation');

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
  'alt-text-generator.live.postman_environment.json',
);
const REPORTS_DIR = path.join(ROOT, 'reports', 'newman');
const PUBLIC_DEPLOY_FOLDER = '95 Post Deploy Verification';
const PROTECTED_DEPLOY_FOLDER = '96 Post Deploy Protected Verification';
const DEPLOY_STABILIZATION_POLL_INTERVAL_MS = 3_000;
const DEPLOY_STABILIZATION_REQUIRED_SUCCESSES = 3;
const DEPLOY_STABILIZATION_TIMEOUT_MS = 90_000;
const DEPLOY_STABILIZATION_REQUEST_TIMEOUT_MS = 15_000;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const sleep = (durationMs) => new Promise((resolve) => {
  setTimeout(resolve, durationMs);
});

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
    : 'Skipping 96 Post Deploy Protected Verification because '
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
 * Resolves the low-cost live-provider plans used during post-deploy verification.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{
 *   providerPlans: { folderName: string, envVars: string[], scopeKey: string }[],
 *   providerScope: string,
 * }}
 */
function resolvePostDeployProviderPlans(env = process.env) {
  const availableProviders = detectAvailableProviders(env, {
    allowedProviderScopes: LOW_COST_PROVIDER_VALIDATION_SCOPES,
  });
  const providerScope = resolveProviderScope({
    requestedScope: env.LIVE_PROVIDER_SCOPE,
    configuredScope: env.LIVE_PROVIDER_SCOPE,
    configuredProviderScopes: availableProviders.configuredProviderScopes,
  });
  const providerPlans = getSelectedProviderPlans(providerScope, {
    configuredProviderScopes: availableProviders.configuredProviderScopes,
  });

  if (providerPlans.length === 0) {
    throw new Error(`Post-deploy provider validation resolved no folders for scope "${providerScope}"`);
  }

  return {
    providerPlans,
    providerScope,
  };
}

/**
 * Builds the Newman environment variables for deploy verification.
 *
 * @param {string} baseUrl
 * @param {{
 *   deployValidationApiToken: string,
 *   productionApiAuthEnabled: 'true'|'false',
 * }} options
 * @returns {{
 *   baseUrl: string,
 *   deployScrapePageUrl: string,
 *   deployValidationApiToken: string,
 *   expectedSwaggerServerUrl: string,
 *   productionApiAuthEnabled: 'true'|'false',
 * }}
 */
function buildDeployEnvVars(
  baseUrl,
  {
    deployValidationApiToken,
    productionApiAuthEnabled,
  },
) {
  return {
    baseUrl,
    deployScrapePageUrl: new URL('api-docs/', `${baseUrl}/`).toString(),
    deployValidationApiToken,
    expectedSwaggerServerUrl: baseUrl,
    productionApiAuthEnabled,
  };
}

/**
 * Builds the deployed endpoint URLs used during rollout stabilization probes.
 *
 * @param {string} baseUrl
 * @param {{
 *   deployValidationApiToken: string,
 *   productionApiAuthEnabled: 'true'|'false',
 * }} options
 * @returns {{
 *   authenticatedProtectedUrl: string,
 *   healthUrl: string,
 *   unauthenticatedProtectedUrl: string,
 * }}
 */
function buildDeployProbeUrls(baseUrl, options) {
  const deployEnvVars = buildDeployEnvVars(baseUrl, options);
  const protectedUrl = new URL('/api/scraper/images', `${baseUrl}/`);
  protectedUrl.searchParams.set('url', deployEnvVars.deployScrapePageUrl);

  return {
    authenticatedProtectedUrl: protectedUrl.toString(),
    healthUrl: new URL('/api/health', `${baseUrl}/`).toString(),
    unauthenticatedProtectedUrl: protectedUrl.toString(),
  };
}

/**
 * Checks whether a response exposes the expected rate-limit headers.
 *
 * @param {{ get(name: string): string|null, has(name: string): boolean }} headers
 * @returns {boolean}
 */
function hasRequiredRateLimitHeaders(headers) {
  return ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']
    .every((headerName) => headers.has(headerName) || headers.has(headerName.toUpperCase()));
}

/**
 * Executes a deploy rollout probe request.
 *
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @param {{ headers?: Record<string, string> }} [options]
 * @returns {Promise<{
 *   error?: Error,
 *   headers?: Headers,
 *   jsonBody?: unknown,
 *   status?: number,
 * }>}
 */
async function requestDeployProbe(fetchFn, url, options = {}) {
  try {
    const response = await fetchFn(url, {
      headers: options.headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(DEPLOY_STABILIZATION_REQUEST_TIMEOUT_MS),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();
    let jsonBody;

    if (contentType.includes('application/json')) {
      try {
        jsonBody = JSON.parse(responseText);
      } catch (error) {
        jsonBody = undefined;
      }
    }

    return {
      headers: response.headers,
      jsonBody,
      status: response.status,
    };
  } catch (error) {
    return {
      error,
    };
  }
}

/**
 * Computes rollout stabilization issues from the latest probe responses.
 *
 * @param {{
 *   authenticatedProtectedProbe?: {
 *     error?: Error,
 *     jsonBody?: unknown,
 *     status?: number,
 *   }|null,
 *   healthProbe: {
 *     error?: Error,
 *     headers?: Headers,
 *     status?: number,
 *   },
 *   productionApiAuthEnabled: 'true'|'false',
 *   protectedVerificationEnabled: boolean,
 *   unauthenticatedProtectedProbe: {
 *     error?: Error,
 *     jsonBody?: unknown,
 *     status?: number,
 *   },
 * }} input
 * @returns {string[]}
 */
function collectDeployStabilizationIssues({
  authenticatedProtectedProbe,
  healthProbe,
  productionApiAuthEnabled,
  protectedVerificationEnabled,
  unauthenticatedProtectedProbe,
}) {
  const issues = [];

  if (healthProbe.error) {
    issues.push(`health probe failed: ${healthProbe.error.message}`);
  } else {
    if (healthProbe.status !== 200) {
      issues.push(`health probe returned ${healthProbe.status}`);
    }

    if (!healthProbe.headers || !hasRequiredRateLimitHeaders(healthProbe.headers)) {
      issues.push('health probe is missing rate-limit headers');
    }
  }

  if (unauthenticatedProtectedProbe.error) {
    issues.push(`protected auth probe failed: ${unauthenticatedProtectedProbe.error.message}`);
  } else if (productionApiAuthEnabled === 'true') {
    if (unauthenticatedProtectedProbe.status !== 401) {
      issues.push(
        `protected auth probe returned ${unauthenticatedProtectedProbe.status}; expected 401`,
      );
    }

    if (unauthenticatedProtectedProbe.jsonBody?.code !== 'API_AUTHENTICATION_FAILED') {
      issues.push('protected auth probe did not return API_AUTHENTICATION_FAILED');
    }
  } else if (unauthenticatedProtectedProbe.status !== 200) {
    issues.push(
      `protected auth probe returned ${unauthenticatedProtectedProbe.status}; expected 200`,
    );
  }

  if (!protectedVerificationEnabled) {
    return issues;
  }

  if (!authenticatedProtectedProbe || authenticatedProtectedProbe.error) {
    issues.push(
      authenticatedProtectedProbe?.error
        ? `authenticated protected probe failed: ${authenticatedProtectedProbe.error.message}`
        : 'authenticated protected probe did not run',
    );
    return issues;
  }

  if (authenticatedProtectedProbe.status !== 200) {
    issues.push(
      `authenticated protected probe returned ${authenticatedProtectedProbe.status}; expected 200`,
    );
  }

  return issues;
}

/**
 * Waits for deploy probes to stabilize so rollout overlap does not fail Newman prematurely.
 *
 * @param {string} baseUrl
 * @param {{
 *   deployValidationApiToken: string,
 *   productionApiAuthEnabled: 'true'|'false',
 *   protectedVerificationEnabled: boolean,
 * }} authConfig
 * @param {{
 *   fetchFn?: typeof fetch,
 *   nowFn?: () => number,
 *   pollIntervalMs?: number,
 *   requiredConsecutiveSuccesses?: number,
 *   sleepFn?: (durationMs: number) => Promise<void>,
 *   timeoutMs?: number,
 *   writeLog?: (message: string) => void,
 * }} [options]
 * @returns {Promise<void>}
 */
async function waitForStableDeploy(
  baseUrl,
  authConfig,
  {
    fetchFn = fetch,
    nowFn = Date.now,
    pollIntervalMs = DEPLOY_STABILIZATION_POLL_INTERVAL_MS,
    requiredConsecutiveSuccesses = DEPLOY_STABILIZATION_REQUIRED_SUCCESSES,
    sleepFn = sleep,
    timeoutMs = DEPLOY_STABILIZATION_TIMEOUT_MS,
    writeLog = (message) => process.stdout.write(`${message}\n`),
  } = {},
) {
  const deadline = nowFn() + timeoutMs;
  const probeUrls = buildDeployProbeUrls(baseUrl, authConfig);
  const attempt = async ({
    attemptCount,
    consecutiveSuccesses,
    lastIssues,
  }) => {
    if (nowFn() >= deadline) {
      throw new Error(
        `Timed out waiting for deploy rollout to stabilize at ${baseUrl}. `
        + `Last observed issues: ${lastIssues.join('; ')}`,
      );
    }

    const nextAttemptCount = attemptCount + 1;
    const healthProbe = await requestDeployProbe(fetchFn, probeUrls.healthUrl);
    const unauthenticatedProtectedProbe = await requestDeployProbe(
      fetchFn,
      probeUrls.unauthenticatedProtectedUrl,
      { headers: { Accept: 'application/json' } },
    );
    const authenticatedProtectedProbe = authConfig.protectedVerificationEnabled
      ? await requestDeployProbe(
        fetchFn,
        probeUrls.authenticatedProtectedUrl,
        {
          headers: {
            Accept: 'application/json',
            'X-API-Key': authConfig.deployValidationApiToken,
          },
        },
      )
      : null;
    const issues = collectDeployStabilizationIssues({
      authenticatedProtectedProbe,
      healthProbe,
      productionApiAuthEnabled: authConfig.productionApiAuthEnabled,
      protectedVerificationEnabled: authConfig.protectedVerificationEnabled,
      unauthenticatedProtectedProbe,
    });

    if (issues.length === 0) {
      const nextConsecutiveSuccesses = consecutiveSuccesses + 1;
      writeLog(
        `[deploy] rollout probe ${nextAttemptCount} is stable `
        + `(${nextConsecutiveSuccesses}/${requiredConsecutiveSuccesses})`,
      );

      if (nextConsecutiveSuccesses >= requiredConsecutiveSuccesses) {
        return;
      }

      await sleepFn(pollIntervalMs);
      await attempt({
        attemptCount: nextAttemptCount,
        consecutiveSuccesses: nextConsecutiveSuccesses,
        lastIssues,
      });
      return;
    }

    writeLog(`[deploy] waiting for stable deploy rollout: ${issues.join('; ')}`);
    await sleepFn(pollIntervalMs);
    await attempt({
      attemptCount: nextAttemptCount,
      consecutiveSuccesses: 0,
      lastIssues: issues,
    });
  };

  await attempt({
    attemptCount: 0,
    consecutiveSuccesses: 0,
    lastIssues: ['no rollout probes executed'],
  });
}

/**
 * Builds the Newman CLI arguments for deploy verification.
 *
 * @param {string} baseUrl
 * @param {{
 *   allureResultsDir?: string | null,
 *   deployValidationApiToken: string,
 *   folders: string[],
 *   productionApiAuthEnabled: 'true'|'false',
 * }} options
 * @returns {string[]}
 */
function buildDeployNewmanArgs(
  baseUrl,
  {
    allureResultsDir = null,
    deployValidationApiToken,
    folders,
    productionApiAuthEnabled,
  },
) {
  const folderArgs = folders.flatMap((folder) => ['--folder', folder]);
  const envVarArgs = Object.entries(buildDeployEnvVars(baseUrl, {
    deployValidationApiToken,
    productionApiAuthEnabled,
  })).flatMap(([key, value]) => ['--env-var', `${key}=${value}`]);
  return [
    '--no-install',
    'newman',
    'run',
    COLLECTION_PATH,
    '-e',
    ENV_PATH,
    ...envVarArgs,
    '--timeout-request',
    '45000',
    '--timeout-script',
    '10000',
    ...buildNewmanReporterArgs({
      label: 'post-deploy',
      reportsDir: REPORTS_DIR,
      allureResultsDir,
    }),
    ...folderArgs,
  ];
}

/**
 * Runs the deploy Newman folder.
 *
 * @param {string} baseUrl
 * @param {{
 *   allureResultsDir?: string | null,
 *   deployValidationApiToken: string,
 *   folders: string[],
 *   productionApiAuthEnabled: 'true'|'false',
 * }} options
 * @returns {Promise<void>}
 */
function runNewman(
  baseUrl,
  {
    allureResultsDir = null,
    deployValidationApiToken,
    folders,
    productionApiAuthEnabled,
  },
) {
  const args = buildDeployNewmanArgs(baseUrl, {
    allureResultsDir,
    deployValidationApiToken,
    folders,
    productionApiAuthEnabled,
  });
  const { jsonReportPath } = buildNewmanReportPaths({
    label: 'post-deploy',
    reportsDir: REPORTS_DIR,
  });

  return runNewmanCommand({
    args: [NPX, ...args],
    collectionPath: COLLECTION_PATH,
    cwd: ROOT,
    folders,
    label: 'post-deploy',
    reportPath: jsonReportPath,
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
  const allureResultsDir = resolveAllureResultsDir(process.env, ROOT);
  const authConfig = resolveProductionDeployAuthConfig(process.env);
  const { providerPlans } = resolvePostDeployProviderPlans(process.env);
  const collection = readCollection(COLLECTION_PATH);
  const availableFolders = listTopLevelFolderNames(collection);
  const selectedFolders = [PUBLIC_DEPLOY_FOLDER];
  const providerValidationFolders = Array.from(
    new Set(providerPlans.map((providerPlan) => providerPlan.folderName)),
  );

  if (authConfig.protectedVerificationEnabled) {
    selectedFolders.push(PROTECTED_DEPLOY_FOLDER);
  } else {
    process.stdout.write(`${authConfig.protectedVerificationSkipReason}\n`);
  }

  assertTopLevelFoldersExist(
    availableFolders,
    selectedFolders,
    'post-deploy mode',
  );
  assertTopLevelFoldersExist(
    availableFolders,
    providerValidationFolders,
    'post-deploy provider-validation mode',
  );

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  if (allureResultsDir) {
    await fs.mkdir(allureResultsDir, { recursive: true });
  }
  await assertProviderValidationFixturesReachable(
    buildLiveProviderEnvVars(normalizedBaseUrl, authConfig),
  );
  await waitForStableDeploy(normalizedBaseUrl, authConfig);
  await runNewman(normalizedBaseUrl, {
    allureResultsDir,
    deployValidationApiToken: authConfig.deployValidationApiToken,
    folders: selectedFolders,
    productionApiAuthEnabled: authConfig.productionApiAuthEnabled,
  });
  await providerPlans.reduce(
    (runPromise, providerPlan) => runPromise.then(() => runLiveProviderNewman(
      normalizedBaseUrl,
      {
        allureResultsDir,
        authConfig,
        folders: [providerPlan.folderName],
        label: `post-deploy-provider-${providerPlan.scopeKey}`,
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
  buildDeployEnvVars,
  buildDeployNewmanArgs,
  buildDeployProbeUrls,
  collectDeployStabilizationIssues,
  hasRequiredRateLimitHeaders,
  normalizeBaseUrl,
  normalizeBooleanFlag,
  parseArgs,
  requestDeployProbe,
  resolvePostDeployProviderPlans,
  resolveProductionDeployAuthConfig,
  waitForStableDeploy,
};
