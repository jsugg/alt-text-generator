#!/usr/bin/env node

/**
 * Boots the local app and deterministic fixture server,
 * then executes Newman folders and writes JSON/JUnit artifacts.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
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
  LOW_COST_PROVIDER_VALIDATION_SCOPES,
  getSelectedProviderPlans,
  resolveProviderScope,
  detectAvailableProviders,
} = require('./postman/provider-validation-scope');
const {
  buildNewmanReportPaths,
  buildNewmanReporterArgs,
  resolveRunLayout,
} = require('./postman/newman-reporting');
const {
  allocateNamedPorts,
  diagnoseFixedPorts,
  formatPortConflictDiagnostics,
  isTruthyFlag,
} = require('./postman/port-allocator');
const {
  assertProviderValidationFixturesReachable,
} = require('./postman/provider-validation-fixture-probe');
const {
  runNewmanCommand,
} = require('./postman/newman-runner');
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
const { buildAppServerEnv } = require('./postman/app-server-env');

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
const HOST = '127.0.0.1';

// Default listener ports used only when fixed-port debug mode is enabled. The
// default (dynamic) mode allocates free ports per run so concurrent harness
// invocations never collide.
const DEFAULT_APP_HTTP_PORT = 8080;
const DEFAULT_APP_HTTPS_PORT = 8443;
const DEFAULT_AUTH_APP_HTTP_PORT = 18080;
const DEFAULT_AUTH_APP_HTTPS_PORT = 18443;
const DEFAULT_FIXTURE_PORT = 19090;

const API_AUTH_TOKEN = process.env.POSTMAN_API_AUTH_TOKEN || 'postman-api-token';
const FULL_MODE_DESCRIPTION_JOB_WAIT_TIMEOUT_MS = '25';
const FULL_MODE_DESCRIPTION_JOB_POLL_INTERVAL_MS = '5';
const FULL_MODE_REPLICATE_POLL_INTERVAL_MS = '5';
const DOCS_WARMUP_TIMEOUT_MS = 30000;
const READINESS_TIMEOUT_MS = 120000;

const NODE = process.execPath;
const NEWMAN_BIN = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'newman.cmd' : 'newman',
);
const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
};

// Newman environment keys whose values embed a harness port, mapped to a
// builder that recomputes them from the resolved ports. Used to materialize a
// per-run environment file that carries the actually-bound ports.
const RESOLVED_ENV_VALUE_BUILDERS = {
  baseUrl: ({ host, ports }) => `https://${host}:${ports.appHttps}`,
  baseUrlHttp: ({ host, ports }) => `http://${host}:${ports.appHttp}`,
  fixtureBaseUrl: ({ host, ports }) => `http://${host}:${ports.fixture}`,
  samplePageUrl: ({ host, ports }) => `http://${host}:${ports.fixture}/fixtures/page-with-images`,
  samplePartialPageUrl: ({ host, ports }) => `http://${host}:${ports.fixture}/fixtures/page-with-partial-images`,
  sampleProviderFailurePageUrl: ({ host, ports }) => `http://${host}:${ports.fixture}/fixtures/page-with-provider-failure`,
  sampleImageAUrl: ({ host, ports }) => `http://${host}:${ports.fixture}/assets/a.png`,
  sampleImageBUrl: ({ host, ports }) => `http://${host}:${ports.fixture}/assets/b.png`,
  missingImageUrl: ({ host, ports }) => `http://${host}:${ports.fixture}/assets/missing.png`,
  providerFailureImageUrl: ({ host, ports }) => `http://${host}:${ports.fixture}/assets/provider-error.png`,
  expectedSwaggerServerUrl: ({ ports }) => `https://localhost:${ports.appHttps}`,
  authBaseUrl: ({ host, ports }) => (
    ports.authHttps ? `https://${host}:${ports.authHttps}` : null
  ),
};

/**
 * @param {string} filePath
 * @returns {object}
 */
function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Determines whether the harness should only resolve and report its execution
 * plan (ports + per-run directories) without booting servers or running Newman.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} argv
 * @returns {boolean}
 */
function isPlanOnly(env, argv) {
  return isTruthyFlag(env.POSTMAN_HARNESS_PLAN_ONLY) || argv.includes('--plan');
}

/**
 * Resolves the port allocation mode. Dynamic free-port allocation is the
 * default; fixed ports are opt-in for debugging against stable local ports.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {'dynamic' | 'fixed'}
 */
function resolvePortMode(env) {
  const explicitMode = String(env.POSTMAN_PORT_MODE ?? '').trim().toLowerCase();

  if (explicitMode === 'fixed' || explicitMode === 'dynamic') {
    return explicitMode;
  }

  return isTruthyFlag(env.POSTMAN_FIXED_PORTS) ? 'fixed' : 'dynamic';
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readFixedPort(env, name, fallback) {
  const raw = env[name];

  if (raw === undefined || String(raw).trim() === '') {
    return fallback;
  }

  const parsed = Number(String(raw).trim());

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid ${name}="${raw}"; expected an integer port in [0, 65535]`);
  }

  return parsed;
}

/**
 * @param {{ requiresAuthHarness: boolean }} options
 * @returns {string[]}
 */
function buildPortRoles({ requiresAuthHarness }) {
  const roles = ['appHttp', 'appHttps', 'fixture'];

  if (requiresAuthHarness) {
    roles.push('authHttp', 'authHttps');
  }

  return roles;
}

/**
 * Resolves the listener ports for every harness role. Dynamic mode allocates
 * distinct free ports; fixed mode reads stable ports and fails fast (with
 * diagnostics) when any of them is already in use.
 *
 * @param {{
 *   env: NodeJS.ProcessEnv,
 *   host: string,
 *   mode: 'dynamic' | 'fixed',
 *   requiresAuthHarness: boolean,
 * }} options
 * @returns {Promise<Record<string, number>>}
 */
async function resolveHarnessPorts({
  env, host, mode, requiresAuthHarness,
}) {
  const roles = buildPortRoles({ requiresAuthHarness });

  if (mode === 'dynamic') {
    return allocateNamedPorts(roles, { host });
  }

  const fixedPorts = {
    appHttp: readFixedPort(env, 'POSTMAN_APP_HTTP_PORT', DEFAULT_APP_HTTP_PORT),
    appHttps: readFixedPort(env, 'POSTMAN_APP_HTTPS_PORT', DEFAULT_APP_HTTPS_PORT),
    fixture: readFixedPort(env, 'POSTMAN_FIXTURE_PORT', DEFAULT_FIXTURE_PORT),
    authHttp: readFixedPort(env, 'POSTMAN_AUTH_HTTP_PORT', DEFAULT_AUTH_APP_HTTP_PORT),
    authHttps: readFixedPort(env, 'POSTMAN_AUTH_HTTPS_PORT', DEFAULT_AUTH_APP_HTTPS_PORT),
  };
  const ports = Object.fromEntries(roles.map((role) => [role, fixedPorts[role]]));
  const { conflicts } = await diagnoseFixedPorts(
    roles.map((role) => ({ role, port: ports[role] })),
    { host },
  );

  if (conflicts.length > 0) {
    throw new Error(formatPortConflictDiagnostics(conflicts, { host }));
  }

  return ports;
}

/**
 * Builds the Newman --env-var overrides that carry the resolved app and fixture
 * URLs into the collection.
 *
 * @param {{ host: string, ports: Record<string, number> }} options
 * @returns {string[]}
 */
function buildHarnessUrlEnvVars({ host, ports }) {
  return Object.entries(RESOLVED_ENV_VALUE_BUILDERS)
    .filter(([key]) => key !== 'authBaseUrl')
    .map(([key, build]) => `${key}=${build({ host, ports })}`);
}

/**
 * Clones the static Newman environment and rewrites every port-bearing value to
 * the resolved ports, producing the per-run environment file.
 *
 * @param {object} staticEnvironment
 * @param {{ host: string, ports: Record<string, number> }} options
 * @returns {object}
 */
function buildResolvedNewmanEnvironment(staticEnvironment, { host, ports }) {
  const resolved = JSON.parse(JSON.stringify(staticEnvironment));

  resolved.values = (resolved.values || []).map((entry) => {
    const build = RESOLVED_ENV_VALUE_BUILDERS[entry.key];

    if (!build) {
      return entry;
    }

    const value = build({ host, ports });

    return value === null ? entry : { ...entry, value };
  });

  return resolved;
}

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
 * Fetches a URL, following the same TLS settings Newman uses locally.
 *
 * @param {string} urlString
 * @param {{ insecure?: boolean, timeoutMs?: number }} options
 * @returns {Promise<{ body: string, durationMs: number, statusCode: number }>}
 */
function fetchUrl(urlString, { insecure = false, timeoutMs = DOCS_WARMUP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const url = new URL(urlString);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        rejectUnauthorized: !insecure,
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            durationMs: Date.now() - startedAt,
            statusCode: res.statusCode || 0,
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out after ${timeoutMs}ms fetching ${urlString}`));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Warms documentation routes before Newman enforces steady-state response budgets.
 *
 * @param {string} baseUrl
 * @returns {Promise<void>}
 */
async function warmUpSwaggerDocs(baseUrl) {
  const docsUrl = `${baseUrl}/api-docs/`;
  const initUrl = `${baseUrl}/api-docs/swagger-ui-init.js`;
  const docs = await fetchUrl(docsUrl, { insecure: true });

  if (docs.statusCode !== 200 || docs.body.length <= 100) {
    throw new Error(`Swagger UI warm-up failed with status ${docs.statusCode}`);
  }

  process.stdout.write(
    `[warm-up] Swagger UI cold start completed in ${docs.durationMs}ms outside Newman budgets\n`,
  );

  const init = await fetchUrl(initUrl, { insecure: true });
  if (init.statusCode !== 200 || !init.body.includes('"servers"')) {
    throw new Error(`Swagger init warm-up failed with status ${init.statusCode}`);
  }

  process.stdout.write(
    `[warm-up] Swagger init cold start completed in ${init.durationMs}ms outside Newman budgets\n`,
  );
}

/**
 * Spawns a child process and streams logs with a prefix.
 *
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @param {{ logPath?: string | null }} options
 * @returns {import('node:child_process').ChildProcess}
 */
function spawnLogged(label, command, args, env = {}, { logPath = null } = {}) {
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '');
  }

  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    const line = `[${label}] ${chunk}`;
    process.stdout.write(line);
    if (logPath) {
      fs.appendFileSync(logPath, line);
    }
  });

  child.stderr.on('data', (chunk) => {
    const line = `[${label}] ${chunk}`;
    process.stderr.write(line);
    if (logPath) {
      fs.appendFileSync(logPath, line);
    }
  });

  child.on('exit', (code, signal) => {
    if (logPath) {
      fs.appendFileSync(logPath, `[${label}] exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
    }
  });

  return child;
}

/**
 * Runs Newman for the given folder list.
 *
 * @param {string} label
 * @param {string[]} folders
 * @param {{
 *   allureResultsDir?: string | null,
 *   diagnosticsDir: string,
 *   envPath?: string,
 *   envVars?: string[],
 *   extraArgs?: string[],
 *   harnessEnvVars?: string[],
 *   maxResponseTimeMs?: number,
 *   providerValidationFixtureUrls?: {
 *     providerValidationAzureImageUrl: string,
 *     providerValidationAzurePageUrl: string,
 *     providerValidationImageUrl: string,
 *     providerValidationPageUrl: string,
 *   },
 *   reportsDir: string,
 *   diagnosticLogs?: { label: string, path: string }[],
 *   timeoutRequestMs?: number,
 * }} options
 * @returns {Promise<void>}
 */
function runNewman(
  label,
  folders,
  {
    allureResultsDir = null,
    diagnosticsDir,
    envPath,
    envVars = [],
    extraArgs = [],
    harnessEnvVars = [],
    maxResponseTimeMs = DEFAULT_MAX_RESPONSE_TIME_MS,
    diagnosticLogs = [],
    providerValidationFixtureUrls = buildPublicProviderValidationFixtureUrls(),
    reportsDir,
    timeoutRequestMs = DEFAULT_NEWMAN_TIMEOUT_REQUEST_MS,
  } = {},
) {
  const folderArgs = folders.flatMap((folder) => ['--folder', folder]);
  const { jsonReportPath } = buildNewmanReportPaths({
    label,
    reportsDir,
  });

  const args = [
    NEWMAN_BIN,
    'run',
    COLLECTION_PATH,
    '-e',
    envPath,
    ...harnessEnvVars.flatMap((envVar) => ['--env-var', envVar]),
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
      reportsDir,
      allureResultsDir,
    }),
    ...folderArgs,
    ...extraArgs,
  ];

  return runNewmanCommand({
    args,
    collectionPath: COLLECTION_PATH,
    cwd: ROOT,
    diagnosticLogs,
    folders,
    label,
    newmanLogPath: path.join(diagnosticsDir, `newman-${label}.log`),
    reportPath: jsonReportPath,
  });
}

/**
 * Terminates a child process if it is still alive.
 *
 * @param {import('node:child_process').ChildProcess | undefined} child
 * @returns {Promise<void>}
 */
function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5000);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

/**
 * Emits child process log locations when the harness fails outside Newman.
 *
 * @param {Error} error
 * @param {{ label: string, path: string }[]} diagnosticLogs
 */
function emitHarnessFailureDiagnostics(error, diagnosticLogs) {
  if (diagnosticLogs.length === 0) {
    return;
  }

  process.stderr.write('::group::Postman Harness Process Diagnostics\n');
  process.stderr.write(`[harness] ${error.message}\n`);
  diagnosticLogs.forEach((diagnosticLog) => {
    const relativeLogPath = path.relative(ROOT, diagnosticLog.path)
      || path.basename(diagnosticLog.path);
    process.stderr.write(`- ${diagnosticLog.label}: ${relativeLogPath}\n`);
  });
  process.stderr.write('::endgroup::\n');
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
  const fullModeEnabled = mode === 'full';
  const realProviderModeEnabled = mode === 'real-provider';
  const providerValidationModeEnabled = fullModeEnabled || realProviderModeEnabled;
  const requiresAuthHarness = mode === 'smoke' || fullModeEnabled;

  const host = HOST;
  const portMode = resolvePortMode(process.env);
  const ports = await resolveHarnessPorts({
    env: process.env, host, mode: portMode, requiresAuthHarness,
  });
  const runLayout = resolveRunLayout({ env: process.env, rootDir: ROOT });
  const { allureResultsDir } = runLayout;
  const harnessEnvVars = buildHarnessUrlEnvVars({ host, ports });

  await fsp.mkdir(runLayout.runDir, { recursive: true });
  await fsp.mkdir(runLayout.diagnosticsDir, { recursive: true });
  await fsp.mkdir(runLayout.metaDir, { recursive: true });
  await fsp.mkdir(allureResultsDir, { recursive: true });

  const resolvedEnvPath = path.join(runLayout.metaDir, 'newman-environment.resolved.json');
  await fsp.writeFile(
    resolvedEnvPath,
    `${JSON.stringify(
      buildResolvedNewmanEnvironment(readJsonFile(ENV_PATH), { host, ports }),
      null,
      2,
    )}\n`,
  );

  const harnessPlan = {
    mode,
    portMode,
    host,
    ports,
    runId: runLayout.runId,
    baseDir: runLayout.baseDir,
    runDir: runLayout.runDir,
    reportsDir: runLayout.reportsDir,
    diagnosticsDir: runLayout.diagnosticsDir,
    metaDir: runLayout.metaDir,
    allureResultsDir,
    resolvedEnvPath,
  };
  await fsp.writeFile(
    path.join(runLayout.metaDir, 'resolved-ports.json'),
    `${JSON.stringify(harnessPlan, null, 2)}\n`,
  );

  process.stdout.write(
    `[harness] mode=${mode} portMode=${portMode} runId=${runLayout.runId}\n`,
  );
  process.stdout.write(`[harness] resolved ports ${JSON.stringify(ports)}\n`);
  process.stdout.write(
    `[harness] output dir ${path.relative(ROOT, runLayout.runDir) || runLayout.runDir}\n`,
  );

  if (isPlanOnly(process.env, process.argv)) {
    process.stdout.write(`HARNESS_PLAN ${JSON.stringify(harnessPlan)}\n`);
    return;
  }

  const providerScopeInput = process.env.LIVE_PROVIDER_SCOPE || 'all';
  const liveAzureSubscriptionKey = process.env.ACV_SUBSCRIPTION_KEY || null;
  const mockProviderConfig = buildLocalMockProviderConfig({
    host,
    port: ports.fixture,
  });
  const mockProviderValidationFixtureUrls = buildLocalMockProviderValidationFixtureUrls({
    host,
    port: ports.fixture,
  });
  const publicProviderValidationFixtures = buildPublicProviderValidationFixtureUrls();
  const availableLiveProviders = realProviderModeEnabled
    ? detectAvailableProviders(process.env, {
        allowedProviderScopes: LOW_COST_PROVIDER_VALIDATION_SCOPES,
      })
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
        mode: fullModeEnabled ? 'provider-integration' : 'live',
      })
    : [];
  const selectedProviderScopeSet = new Set(
    selectedProviderPlans.map((providerPlan) => providerPlan.scopeKey),
  );
  let appReplicateApiToken = fullModeEnabled ? mockProviderConfig.replicateApiToken : 'test-token';
  let appReplicateApiEndpoint = fullModeEnabled ? mockProviderConfig.replicateApiEndpoint : null;
  let appAzureApiEndpoint = fullModeEnabled
    ? mockProviderConfig.azureApiEndpoint
    : `http://${host}:${ports.fixture}/vision/v3.2/describe`;
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
  const localFixtureAllowedHost = `${host}:${ports.fixture}`;
  const fullModeDescriptionJobWaitTimeoutMs = fullModeEnabled
    ? FULL_MODE_DESCRIPTION_JOB_WAIT_TIMEOUT_MS
    : null;
  const fullModeDescriptionJobPollIntervalMs = fullModeEnabled
    ? FULL_MODE_DESCRIPTION_JOB_POLL_INTERVAL_MS
    : null;
  const fullModeReplicatePollIntervalMs = fullModeEnabled
    ? FULL_MODE_REPLICATE_POLL_INTERVAL_MS
    : null;
  const providerValidationFixtureUrls = fullModeEnabled
    ? mockProviderValidationFixtureUrls
    : publicProviderValidationFixtures;

  if (realProviderModeEnabled) {
    await assertProviderValidationFixturesReachable(providerValidationFixtureUrls);
  }

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
    ...(ports.authHttps ? [`authBaseUrl=https://${host}:${ports.authHttps}`] : []),
    `apiAuthToken=${API_AUTH_TOKEN}`,
  ];

  const childDiagnosticLogs = [];
  const fixtureLogPath = path.join(runLayout.diagnosticsDir, 'fixture.log');
  const appLogPath = path.join(runLayout.diagnosticsDir, 'app.log');
  const authAppLogPath = path.join(runLayout.diagnosticsDir, 'app-auth.log');

  const fixtureServer = spawnLogged(
    'fixture',
    NODE,
    [path.join(ROOT, 'scripts', 'postman-fixture-server.js')],
    {
      POSTMAN_FIXTURE_PORT: String(ports.fixture),
    },
    { logPath: fixtureLogPath },
  );
  childDiagnosticLogs.push({ label: 'fixture', path: fixtureLogPath });
  managedChildren.add(fixtureServer);
  fixtureServer.once('exit', () => managedChildren.delete(fixtureServer));

  const appServer = spawnLogged(
    'app',
    NODE,
    [path.join(ROOT, 'src', 'app.js')],
    buildAppServerEnv({
      httpPort: String(ports.appHttp),
      httpsPort: String(ports.appHttps),
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
      descriptionJobWaitTimeoutMs: fullModeDescriptionJobWaitTimeoutMs,
      descriptionJobPollIntervalMs: fullModeDescriptionJobPollIntervalMs,
      replicatePollIntervalMs: fullModeReplicatePollIntervalMs,
      outboundAllowedHosts: localFixtureAllowedHost,
    }),
    { logPath: appLogPath },
  );
  childDiagnosticLogs.push({ label: 'app', path: appLogPath });
  managedChildren.add(appServer);
  appServer.once('exit', () => managedChildren.delete(appServer));

  let authAppServer;
  if (requiresAuthHarness) {
    authAppServer = spawnLogged(
      'app-auth',
      NODE,
      [path.join(ROOT, 'src', 'app.js')],
      buildAppServerEnv({
        httpPort: String(ports.authHttp),
        httpsPort: String(ports.authHttps),
        replicateApiToken: 'test-token',
        azureApiEndpoint: `http://${host}:${ports.fixture}/vision/v3.2/describe`,
        azureSubscriptionKey: 'stub-key',
        apiAuthTokens: API_AUTH_TOKEN,
        outboundAllowedHosts: localFixtureAllowedHost,
      }),
      { logPath: authAppLogPath },
    );
    childDiagnosticLogs.push({ label: 'app-auth', path: authAppLogPath });
    managedChildren.add(authAppServer);
    authAppServer.once('exit', () => managedChildren.delete(authAppServer));
  }
  const cleanupSignalHandlers = installSignalCleanup(managedChildren);
  const runHarnessNewman = (label, folders, options = {}) => runNewman(label, folders, {
    diagnosticLogs: childDiagnosticLogs,
    diagnosticsDir: runLayout.diagnosticsDir,
    envPath: resolvedEnvPath,
    harnessEnvVars,
    reportsDir: runLayout.reportsDir,
    ...options,
  });

  try {
    await waitForUrl(`http://${host}:${ports.fixture}/health`, {
      timeoutMs: READINESS_TIMEOUT_MS,
    });
    await waitForUrl(`https://${host}:${ports.appHttps}/api/health`, {
      insecure: true,
      timeoutMs: READINESS_TIMEOUT_MS,
    });
    if (authAppServer) {
      await waitForUrl(`https://${host}:${ports.authHttps}/api/health`, {
        insecure: true,
        timeoutMs: READINESS_TIMEOUT_MS,
      });
    }
    if (mode === 'smoke' || fullModeEnabled) {
      await warmUpSwaggerDocs(`https://${host}:${ports.appHttps}`);
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
      await runHarnessNewman(
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
      await runHarnessNewman(
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
          '35 Async Page Description Jobs (Clip Stub)',
          '40 Negative Paths',
        ],
        'full mode',
      );
      await runHarnessNewman(
        'core',
        [
          '00 Core Smoke',
          '07 Route Aliases',
          '08 API Auth Contract',
          '10 Scraper Contract',
          '20 Single Description (Azure Stub)',
          '30 Page Descriptions (Azure Stub)',
          '35 Async Page Description Jobs (Clip Stub)',
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
      await runHarnessNewman(
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
        (runPromise, providerPlan) => runPromise.then(() => runHarnessNewman(
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
  } catch (error) {
    emitHarnessFailureDiagnostics(error, childDiagnosticLogs);
    throw error;
  } finally {
    cleanupSignalHandlers();
    await Promise.all([
      terminate(fixtureServer),
      terminate(appServer),
      terminate(authAppServer),
    ]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
