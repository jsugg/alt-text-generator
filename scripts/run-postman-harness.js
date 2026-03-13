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
  detectAvailableProviders,
  getSelectedProviderFolders,
  getSelectedProviders,
  resolveProviderScope,
} = require('./postman/live-provider-scope');
const {
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
} = require('./postman/newman-reporting');

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
  'alt-text-generator.local.fixture.postman_environment.json',
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
 *   replicateApiToken?: string | null,
 *   azureApiEndpoint?: string | null,
 *   azureSubscriptionKey?: string | null,
 *   apiAuthTokens?: string | null,
 * }} options
 * @returns {Record<string, string>}
 */
function buildAppServerEnv({
  httpPort,
  httpsPort,
  replicateApiToken = null,
  azureApiEndpoint = null,
  azureSubscriptionKey = null,
  apiAuthTokens = null,
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

  if (azureApiEndpoint) {
    env.ACV_API_ENDPOINT = azureApiEndpoint;
  }

  if (azureSubscriptionKey) {
    env.ACV_SUBSCRIPTION_KEY = azureSubscriptionKey;
  }

  if (apiAuthTokens) {
    env.API_AUTH_ENABLED = 'true';
    env.API_AUTH_TOKENS = apiAuthTokens;
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
    'liveAzureImageUrl=https://developer.chrome.com/static/images/ai-homepage-card.png',
    '--env-var',
    'liveAzurePageUrl=https://developer.chrome.com/',
    '--env-var',
    'model=azure',
    '--env-var',
    'maxResponseTimeMs=1500',
    ...envVars.flatMap((envVar) => ['--env-var', envVar]),
    '--timeout-request',
    '10000',
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
  const allureResultsDir = resolveAllureResultsDir(process.env, ROOT);
  const liveModeEnabled = mode === 'live';
  const requiresAuthHarness = mode === 'smoke' || mode === 'full';
  const liveProviderScopeInput = process.env.LIVE_PROVIDER_SCOPE || 'auto';
  const liveAzureSubscriptionKey = process.env.ACV_SUBSCRIPTION_KEY || null;
  const availableLiveProviders = detectAvailableProviders({
    ...process.env,
  });
  const liveProviderScope = liveModeEnabled
    ? resolveProviderScope({
      requestedScope: liveProviderScopeInput,
      configuredProviderScopes: availableLiveProviders.configuredProviderScopes,
    })
    : null;
  const selectedLiveProviders = liveProviderScope
    ? getSelectedProviders(liveProviderScope)
    : { runAzure: false, runReplicate: false };
  let appReplicateApiToken = 'test-token';
  let appAzureApiEndpoint = `http://${HOST}:${FIXTURE_PORT}/vision/v3.2/describe`;
  let appAzureSubscriptionKey = 'stub-key';

  if (liveModeEnabled) {
    appReplicateApiToken = selectedLiveProviders.runReplicate
      ? process.env.REPLICATE_API_TOKEN
      : null;
    appAzureApiEndpoint = selectedLiveProviders.runAzure
      ? process.env.ACV_API_ENDPOINT
      : null;
    appAzureSubscriptionKey = selectedLiveProviders.runAzure
      ? liveAzureSubscriptionKey
      : null;
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
      replicateApiToken: appReplicateApiToken,
      azureApiEndpoint: appAzureApiEndpoint,
      azureSubscriptionKey: appAzureSubscriptionKey,
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

    if (liveModeEnabled) {
      const liveFolders = getSelectedProviderFolders(liveProviderScope);

      if (liveFolders.length === 0) {
        throw new Error(`Live mode enabled but provider scope "${liveProviderScope}" selected no folders`);
      }

      assertTopLevelFoldersExist(
        availableFolders,
        liveFolders,
        'live mode',
      );
      await runNewman(
        'live-provider',
        liveFolders,
        {
          allureResultsDir,
          envVars: localNewmanEnvVars,
          extraArgs: ['--insecure'],
        },
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
