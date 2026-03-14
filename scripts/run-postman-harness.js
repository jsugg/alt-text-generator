#!/usr/bin/env node

/**
 * Boots the local app and deterministic fixture server,
 * then executes Newman folders and writes JSON/JUnit artifacts.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const {
  assertTopLevelFoldersExist,
  listTopLevelFolderNames,
  readCollection,
} = require('./postman/collection-utils');
const {
  getSelectedProviderPlans,
  resolveProviderScope,
  detectAvailableProviders,
} = require('./postman/provider-validation-scope');
const {
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
} = require('./postman/newman-reporting');
const {
  buildPublicProviderValidationFixtureUrls,
} = require('./postman/provider-validation-public-fixtures');
const {
  buildLocalMockProviderConfig,
  buildLocalMockProviderValidationFixtureUrls,
  LOCAL_PROVIDER_VALIDATION_SCOPES,
} = require('./postman/local-provider-mocks');
const {
  DEFAULT_MAX_RESPONSE_TIME_MS,
  DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS,
  PROVIDER_VALIDATION_APP_REQUEST_TIMEOUT_MS,
  resolveMaxResponseTimeMs,
  resolveNewmanTimeoutRequestMs,
} = require('./postman/harness-timeouts');

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
  'alt-text-generator.local.postman_environment.json',
);
const REPORTS_DIR = path.join(ROOT, 'reports', 'newman');

const HOST = '127.0.0.1';
const APP_HTTP_PORT = '8080';
const APP_HTTPS_PORT = '8443';
const AUTH_APP_HTTP_PORT = String(process.env.POSTMAN_AUTH_HTTP_PORT || 18080);
const AUTH_APP_HTTPS_PORT = String(process.env.POSTMAN_AUTH_HTTPS_PORT || 18443);
const FIXTURE_PORT = String(process.env.POSTMAN_FIXTURE_PORT || 19090);
const API_AUTH_TOKEN = process.env.POSTMAN_API_AUTH_TOKEN || 'postman-api-token';

const NODE = process.execPath;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
};

/**
 * Sleeps for the given duration.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Probes a URL until it becomes available or times out.
 *
 * @param {string} urlString
 * @param {{ insecure?: boolean, timeoutMs?: number, intervalMs?: number }} options
 * @returns {Promise<void>}
 */
async function waitForUrl(
  urlString,
  { insecure = false, timeoutMs = 30000, intervalMs = 500 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      // Poll sequentially until the endpoint becomes healthy.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const client = url.protocol === 'https:' ? https : http;

        const req = client.request(
          url,
          {
            method: 'GET',
            rejectUnauthorized: !insecure,
          },
          (res) => {
            res.resume();

            if ((res.statusCode || 500) < 500) {
              resolve();
              return;
            }

            reject(new Error(`Probe failed with status ${res.statusCode}`));
          },
        );

        req.on('error', reject);
        req.end();
      });

      return;
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-await-in-loop
      await sleep(intervalMs);
    }
  }

  throw lastError || new Error(`Timed out waiting for ${urlString}`);
}

/**
 * Spawns a child process and streams logs with a prefix.
 *
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {import('node:child_process').ChildProcess}
 */
function spawnLogged(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });

  return child;
}

/**
 * Builds the environment for a local app instance.
 *
 * @param {{
 *   httpPort: string,
 *   httpsPort: string,
 *   replicateApiEndpoint?: string | null,
 *   replicateApiToken?: string | null,
 *   azureApiEndpoint?: string | null,
 *   azureSubscriptionKey?: string | null,
 *   openaiApiKey?: string | null,
 *   openaiBaseUrl?: string | null,
 *   openaiModel?: string | null,
 *   hfApiKey?: string | null,
 *   hfBaseUrl?: string | null,
 *   hfModel?: string | null,
 *   openrouterApiKey?: string | null,
 *   openrouterBaseUrl?: string | null,
 *   openrouterModel?: string | null,
 *   apiAuthTokens?: string | null,
 *   scraperRequestTimeoutMs?: string | null,
 *   pageDescriptionConcurrency?: string | null,
 * }} options
 * @returns {Record<string, string>}
 */
function buildAppServerEnv({
  httpPort,
  httpsPort,
  replicateApiEndpoint = null,
  replicateApiToken = null,
  azureApiEndpoint = null,
  azureSubscriptionKey = null,
  openaiApiKey = null,
  openaiBaseUrl = null,
  openaiModel = null,
  hfApiKey = null,
  hfBaseUrl = null,
  hfModel = null,
  openrouterApiKey = null,
  openrouterBaseUrl = null,
  openrouterModel = null,
  apiAuthTokens = null,
  scraperRequestTimeoutMs = null,
  pageDescriptionConcurrency = null,
}) {
  const env = {
    NODE_ENV: 'development',
    PORT: httpPort,
    TLS_PORT: httpsPort,
    WORKER_COUNT: '1',
    LOG_LEVEL: 'info',
    SWAGGER_DEV_URL: `https://localhost:${httpsPort}`,
    ACV_LANGUAGE: 'en',
    ACV_MAX_CANDIDATES: '4',
  };

  if (replicateApiToken) {
    env.REPLICATE_API_TOKEN = replicateApiToken;
  }

  if (replicateApiEndpoint) {
    env.REPLICATE_API_ENDPOINT = replicateApiEndpoint;
  }

  if (azureApiEndpoint) {
    env.ACV_API_ENDPOINT = azureApiEndpoint;
  }

  if (azureSubscriptionKey) {
    env.ACV_SUBSCRIPTION_KEY = azureSubscriptionKey;
  }

  if (openaiApiKey) {
    env.OPENAI_API_KEY = openaiApiKey;
  }

  if (openaiBaseUrl) {
    env.OPENAI_BASE_URL = openaiBaseUrl;
  }

  if (openaiModel) {
    env.OPENAI_MODEL = openaiModel;
  }

  if (hfApiKey) {
    env.HF_API_KEY = hfApiKey;
  }

  if (hfBaseUrl) {
    env.HF_BASE_URL = hfBaseUrl;
  }

  if (hfModel) {
    env.HF_MODEL = hfModel;
  }

  if (openrouterApiKey) {
    env.OPENROUTER_API_KEY = openrouterApiKey;
  }

  if (openrouterBaseUrl) {
    env.OPENROUTER_BASE_URL = openrouterBaseUrl;
  }

  if (openrouterModel) {
    env.OPENROUTER_MODEL = openrouterModel;
  }

  if (apiAuthTokens) {
    env.API_AUTH_ENABLED = 'true';
    env.API_AUTH_TOKENS = apiAuthTokens;
  }

  if (scraperRequestTimeoutMs) {
    env.SCRAPER_REQUEST_TIMEOUT_MS = scraperRequestTimeoutMs;
  }

  if (pageDescriptionConcurrency) {
    env.PAGE_DESCRIPTION_CONCURRENCY = pageDescriptionConcurrency;
  }

  return env;
}

/**
 * Runs Newman for the given folder list.
 *
 * @param {string} label
 * @param {string[]} folders
 * @param {{
 *   allureResultsDir?: string | null,
 *   envPath?: string,
 *   envVars?: string[],
 *   extraArgs?: string[],
 *   maxResponseTimeMs?: number,
 *   providerValidationFixtureUrls?: {
 *     providerValidationAzureImageUrl: string,
 *     providerValidationAzurePageUrl: string,
 *     providerValidationImageUrl: string,
 *     providerValidationPageUrl: string,
 *   },
 *   timeoutRequestMs?: number,
 * }} options
 * @returns {Promise<void>}
 */
function runNewman(
  label,
  folders,
  {
    allureResultsDir = null,
    envPath = ENV_PATH,
    envVars = [],
    extraArgs = [],
    maxResponseTimeMs = DEFAULT_MAX_RESPONSE_TIME_MS,
    providerValidationFixtureUrls = buildPublicProviderValidationFixtureUrls(),
    timeoutRequestMs = DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS,
  } = {},
) {
  const folderArgs = folders.flatMap((folder) => ['--folder', folder]);

  const args = [
    '--no-install',
    'newman',
    'run',
    COLLECTION_PATH,
    '-e',
    envPath,
    '--env-var',
    `baseUrl=https://${HOST}:${APP_HTTPS_PORT}`,
    '--env-var',
    `baseUrlHttp=http://${HOST}:${APP_HTTP_PORT}`,
    '--env-var',
    `fixtureBaseUrl=http://${HOST}:${FIXTURE_PORT}`,
    '--env-var',
    `samplePageUrl=http://${HOST}:${FIXTURE_PORT}/fixtures/page-with-images`,
    '--env-var',
    `samplePartialPageUrl=http://${HOST}:${FIXTURE_PORT}/fixtures/page-with-partial-images`,
    '--env-var',
    `sampleProviderFailurePageUrl=http://${HOST}:${FIXTURE_PORT}/fixtures/page-with-provider-failure`,
    '--env-var',
    `sampleImageAUrl=http://${HOST}:${FIXTURE_PORT}/assets/a.png`,
    '--env-var',
    `sampleImageBUrl=http://${HOST}:${FIXTURE_PORT}/assets/b.png`,
    '--env-var',
    `missingImageUrl=http://${HOST}:${FIXTURE_PORT}/assets/missing.png`,
    '--env-var',
    `providerFailureImageUrl=http://${HOST}:${FIXTURE_PORT}/assets/provider-error.png`,
    '--env-var',
    `expectedSwaggerServerUrl=https://localhost:${APP_HTTPS_PORT}`,
    '--env-var',
    `providerValidationImageUrl=${providerValidationFixtureUrls.providerValidationImageUrl}`,
    '--env-var',
    `providerValidationPageUrl=${providerValidationFixtureUrls.providerValidationPageUrl}`,
    '--env-var',
    `providerValidationAzureImageUrl=${providerValidationFixtureUrls.providerValidationAzureImageUrl}`,
    '--env-var',
    `providerValidationAzurePageUrl=${providerValidationFixtureUrls.providerValidationAzurePageUrl}`,
    '--env-var',
    'model=azure',
    '--env-var',
    `maxResponseTimeMs=${maxResponseTimeMs}`,
    ...envVars.flatMap((envVar) => ['--env-var', envVar]),
    '--timeout-request',
    String(timeoutRequestMs),
    '--timeout-script',
    '10000',
    ...buildNewmanReporterArgs({
      label,
      reportsDir: REPORTS_DIR,
      allureResultsDir,
    }),
    ...folderArgs,
    ...extraArgs,
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

      reject(new Error(`Newman run "${label}" failed with exit code ${code}`));
    });

    child.on('error', reject);
  });
}

/**
 * Terminates a child process if it is still alive.
 *
 * @param {import('node:child_process').ChildProcess | undefined} child
 */
function terminate(child) {
  if (!child || child.killed) {
    return;
  }

  child.kill('SIGTERM');
}

/**
 * Installs signal handlers that terminate managed child processes.
 *
 * @param {Set<import('node:child_process').ChildProcess>} children
 * @returns {() => void}
 */
function installSignalCleanup(children) {
  const signalHandlers = Object.entries(SIGNAL_EXIT_CODES).map(([signal, exitCode]) => {
    const handler = () => {
      children.forEach((child) => terminate(child));
      process.exit(exitCode);
    };

    process.on(signal, handler);
    return [signal, handler];
  });

  return () => {
    signalHandlers.forEach(([signal, handler]) => {
      process.off(signal, handler);
    });
  };
}

/**
 * Entry point.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const mode = process.argv[2] || 'full';
  if (!['smoke', 'full', 'real-provider'].includes(mode)) {
    throw new Error(`Unsupported harness mode "${mode}"`);
  }
  const allureResultsDir = resolveAllureResultsDir(process.env, ROOT);
  const fullModeEnabled = mode === 'full';
  const realProviderModeEnabled = mode === 'real-provider';
  const providerValidationModeEnabled = fullModeEnabled || realProviderModeEnabled;
  const requiresAuthHarness = mode === 'smoke' || fullModeEnabled;
  const providerScopeInput = process.env.LIVE_PROVIDER_SCOPE || 'all';
  const liveAzureSubscriptionKey = process.env.ACV_SUBSCRIPTION_KEY || null;
  const mockProviderConfig = buildLocalMockProviderConfig({
    host: HOST,
    port: FIXTURE_PORT,
  });
  const mockProviderValidationFixtureUrls = buildLocalMockProviderValidationFixtureUrls({
    host: HOST,
    port: FIXTURE_PORT,
  });
  const publicProviderValidationFixtures = buildPublicProviderValidationFixtureUrls();
  const availableLiveProviders = realProviderModeEnabled
    ? detectAvailableProviders(process.env)
    : { configuredProviderScopes: LOCAL_PROVIDER_VALIDATION_SCOPES.slice() };
  const configuredProviderScopes = fullModeEnabled
    ? LOCAL_PROVIDER_VALIDATION_SCOPES.slice()
    : availableLiveProviders.configuredProviderScopes;
  let providerValidationScope = null;
  if (providerValidationModeEnabled) {
    providerValidationScope = fullModeEnabled
      ? 'all'
      : resolveProviderScope({
        requestedScope: providerScopeInput,
        configuredProviderScopes,
      });
  }
  const selectedProviderPlans = providerValidationScope
    ? getSelectedProviderPlans(providerValidationScope, {
      configuredProviderScopes,
    })
    : [];
  const selectedProviderScopeSet = new Set(
    selectedProviderPlans.map((providerPlan) => providerPlan.scopeKey),
  );
  let appReplicateApiToken = fullModeEnabled ? mockProviderConfig.replicateApiToken : 'test-token';
  let appReplicateApiEndpoint = fullModeEnabled ? mockProviderConfig.replicateApiEndpoint : null;
  let appAzureApiEndpoint = fullModeEnabled
    ? mockProviderConfig.azureApiEndpoint
    : `http://${HOST}:${FIXTURE_PORT}/vision/v3.2/describe`;
  let appAzureSubscriptionKey = 'stub-key';
  let appOpenAiApiKey = null;
  let appOpenAiBaseUrl = null;
  let appOpenAiModel = null;
  let appHfApiKey = null;
  let appHfBaseUrl = null;
  let appHfModel = null;
  let appOpenRouterApiKey = null;
  let appOpenRouterBaseUrl = null;
  let appOpenRouterModel = null;
  const providerIntegrationScraperRequestTimeoutMs = providerValidationModeEnabled
    ? String(PROVIDER_VALIDATION_APP_REQUEST_TIMEOUT_MS)
    : null;
  const providerIntegrationPageDescriptionConcurrency = providerValidationModeEnabled ? '1' : null;
  const providerValidationFixtureUrls = fullModeEnabled
    ? mockProviderValidationFixtureUrls
    : publicProviderValidationFixtures;

  if (realProviderModeEnabled) {
    appReplicateApiToken = selectedProviderScopeSet.has('replicate')
      ? process.env.REPLICATE_API_TOKEN
      : null;
    appReplicateApiEndpoint = selectedProviderScopeSet.has('replicate')
      ? process.env.REPLICATE_API_ENDPOINT || null
      : null;
    appAzureApiEndpoint = selectedProviderScopeSet.has('azure')
      ? process.env.ACV_API_ENDPOINT
      : null;
    appAzureSubscriptionKey = selectedProviderScopeSet.has('azure')
      ? liveAzureSubscriptionKey
      : null;
    appOpenAiApiKey = selectedProviderScopeSet.has('openai')
      ? process.env.OPENAI_API_KEY
      : null;
    appOpenAiBaseUrl = selectedProviderScopeSet.has('openai')
      ? process.env.OPENAI_BASE_URL || null
      : null;
    appOpenAiModel = selectedProviderScopeSet.has('openai')
      ? process.env.OPENAI_MODEL || null
      : null;
    appHfApiKey = selectedProviderScopeSet.has('huggingface')
      ? process.env.HF_API_KEY || process.env.HF_TOKEN
      : null;
    appHfBaseUrl = selectedProviderScopeSet.has('huggingface')
      ? process.env.HF_BASE_URL || null
      : null;
    appHfModel = selectedProviderScopeSet.has('huggingface')
      ? process.env.HF_MODEL || null
      : null;
    appOpenRouterApiKey = selectedProviderScopeSet.has('openrouter')
      ? process.env.OPENROUTER_API_KEY
      : null;
    appOpenRouterBaseUrl = selectedProviderScopeSet.has('openrouter')
      ? process.env.OPENROUTER_BASE_URL || null
      : null;
    appOpenRouterModel = selectedProviderScopeSet.has('openrouter')
      ? process.env.OPENROUTER_MODEL || null
      : null;
  } else if (fullModeEnabled) {
    appAzureSubscriptionKey = mockProviderConfig.azureSubscriptionKey;
    appOpenAiApiKey = mockProviderConfig.openaiApiKey;
    appOpenAiBaseUrl = mockProviderConfig.openaiBaseUrl;
    appHfApiKey = mockProviderConfig.hfApiKey;
    appHfBaseUrl = mockProviderConfig.hfBaseUrl;
    appOpenRouterApiKey = mockProviderConfig.openrouterApiKey;
    appOpenRouterBaseUrl = mockProviderConfig.openrouterBaseUrl;
  }
  const managedChildren = new Set();
  const collection = readCollection(COLLECTION_PATH);
  const availableFolders = listTopLevelFolderNames(collection);
  const localNewmanEnvVars = [
    `authBaseUrl=https://${HOST}:${AUTH_APP_HTTPS_PORT}`,
    `apiAuthToken=${API_AUTH_TOKEN}`,
  ];

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  if (allureResultsDir) {
    await fs.mkdir(allureResultsDir, { recursive: true });
  }

  const fixtureServer = spawnLogged(
    'fixture',
    NODE,
    [path.join(ROOT, 'scripts', 'postman-fixture-server.js')],
    {
      POSTMAN_FIXTURE_PORT: FIXTURE_PORT,
    },
  );
  managedChildren.add(fixtureServer);
  fixtureServer.once('exit', () => managedChildren.delete(fixtureServer));

  const appServer = spawnLogged(
    'app',
    NODE,
    [path.join(ROOT, 'src', 'app.js')],
    buildAppServerEnv({
      httpPort: APP_HTTP_PORT,
      httpsPort: APP_HTTPS_PORT,
      replicateApiEndpoint: appReplicateApiEndpoint,
      replicateApiToken: appReplicateApiToken,
      azureApiEndpoint: appAzureApiEndpoint,
      azureSubscriptionKey: appAzureSubscriptionKey,
      openaiApiKey: appOpenAiApiKey,
      openaiBaseUrl: appOpenAiBaseUrl,
      openaiModel: appOpenAiModel,
      hfApiKey: appHfApiKey,
      hfBaseUrl: appHfBaseUrl,
      hfModel: appHfModel,
      openrouterApiKey: appOpenRouterApiKey,
      openrouterBaseUrl: appOpenRouterBaseUrl,
      openrouterModel: appOpenRouterModel,
      scraperRequestTimeoutMs: providerIntegrationScraperRequestTimeoutMs,
      pageDescriptionConcurrency: providerIntegrationPageDescriptionConcurrency,
    }),
  );
  managedChildren.add(appServer);
  appServer.once('exit', () => managedChildren.delete(appServer));

  let authAppServer;
  if (requiresAuthHarness) {
    authAppServer = spawnLogged(
      'app-auth',
      NODE,
      [path.join(ROOT, 'src', 'app.js')],
      buildAppServerEnv({
        httpPort: AUTH_APP_HTTP_PORT,
        httpsPort: AUTH_APP_HTTPS_PORT,
        replicateApiToken: 'test-token',
        azureApiEndpoint: `http://${HOST}:${FIXTURE_PORT}/vision/v3.2/describe`,
        azureSubscriptionKey: 'stub-key',
        apiAuthTokens: API_AUTH_TOKEN,
      }),
    );
    managedChildren.add(authAppServer);
    authAppServer.once('exit', () => managedChildren.delete(authAppServer));
  }
  const cleanupSignalHandlers = installSignalCleanup(managedChildren);

  try {
    await waitForUrl(`http://${HOST}:${FIXTURE_PORT}/health`);
    await waitForUrl(`https://${HOST}:${APP_HTTPS_PORT}/api/health`, {
      insecure: true,
    });
    if (authAppServer) {
      await waitForUrl(`https://${HOST}:${AUTH_APP_HTTPS_PORT}/api/health`, {
        insecure: true,
      });
    }

    if (mode === 'smoke') {
      assertTopLevelFoldersExist(
        availableFolders,
        [
          '00 Core Smoke',
          '07 Route Aliases',
          '08 API Auth Contract',
          '10 Scraper Contract',
          '20 Single Description (Azure Stub)',
        ],
        'smoke mode',
      );
      await runNewman(
        'smoke',
        [
          '00 Core Smoke',
          '07 Route Aliases',
          '08 API Auth Contract',
          '10 Scraper Contract',
          '20 Single Description (Azure Stub)',
        ],
        {
          allureResultsDir,
          envVars: localNewmanEnvVars,
          extraArgs: ['--insecure'],
        },
      );

      assertTopLevelFoldersExist(
        availableFolders,
        ['05 Routing & Redirects'],
        'smoke routing verification',
      );
      await runNewman(
        'routing',
        ['05 Routing & Redirects'],
        {
          allureResultsDir,
          envVars: localNewmanEnvVars,
          extraArgs: ['--insecure', '--ignore-redirects'],
        },
      );
    }

    if (mode === 'full') {
      assertTopLevelFoldersExist(
        availableFolders,
        [
          '00 Core Smoke',
          '07 Route Aliases',
          '08 API Auth Contract',
          '10 Scraper Contract',
          '20 Single Description (Azure Stub)',
          '30 Page Descriptions (Azure Stub)',
          '40 Negative Paths',
        ],
        'full mode',
      );
      await runNewman(
        'core',
        [
          '00 Core Smoke',
          '07 Route Aliases',
          '08 API Auth Contract',
          '10 Scraper Contract',
          '20 Single Description (Azure Stub)',
          '30 Page Descriptions (Azure Stub)',
          '40 Negative Paths',
        ],
        {
          allureResultsDir,
          envVars: localNewmanEnvVars,
          extraArgs: ['--insecure'],
        },
      );

      assertTopLevelFoldersExist(
        availableFolders,
        ['05 Routing & Redirects'],
        'full routing verification',
      );
      await runNewman(
        'routing',
        ['05 Routing & Redirects'],
        {
          allureResultsDir,
          envVars: localNewmanEnvVars,
          extraArgs: ['--insecure', '--ignore-redirects'],
        },
      );
    }

    if (providerValidationModeEnabled) {
      const providerValidationFolders = Array.from(
        new Set(selectedProviderPlans.map((providerPlan) => providerPlan.folderName)),
      );
      const providerValidationLabelPrefix = fullModeEnabled
        ? 'local-provider-integration'
        : 'pre-production-provider';

      if (selectedProviderPlans.length === 0) {
        throw new Error(
          'Provider-validation mode enabled but provider scope '
          + `'${providerValidationScope}' selected no folders`,
        );
      }

      assertTopLevelFoldersExist(
        availableFolders,
        providerValidationFolders,
        providerValidationLabelPrefix,
      );

      await selectedProviderPlans.reduce(
        (runPromise, providerPlan) => runPromise.then(() => runNewman(
          `${providerValidationLabelPrefix}-${providerPlan.scopeKey}`,
          [providerPlan.folderName],
          {
            allureResultsDir,
            envVars: [
              ...(fullModeEnabled ? localNewmanEnvVars : []),
              ...providerPlan.envVars,
            ],
            extraArgs: ['--insecure'],
            providerValidationFixtureUrls,
            maxResponseTimeMs: resolveMaxResponseTimeMs({
              providerValidationModeEnabled,
            }),
            timeoutRequestMs: resolveNewmanTimeoutRequestMs({
              providerValidationModeEnabled,
            }),
          },
        )),
        Promise.resolve(),
      );
    }
  } finally {
    cleanupSignalHandlers();
    terminate(fixtureServer);
    terminate(appServer);
    terminate(authAppServer);
  }
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
