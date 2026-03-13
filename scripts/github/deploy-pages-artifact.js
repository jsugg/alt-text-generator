#!/usr/bin/env node

const fs = require('node:fs');

function parseArgs(argv) {
  const args = {
    apiBaseUrl: 'https://api.github.com/',
    environment: 'github-pages',
    outputFile: null,
    pollIntervalMs: 5000,
    timeoutMs: 600000,
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
      case 'api-base-url':
        args.apiBaseUrl = rawValue;
        break;
      case 'artifact-name':
        args.artifactName = rawValue;
        break;
      case 'environment':
        args.environment = rawValue;
        break;
      case 'output-file':
        args.outputFile = rawValue;
        break;
      case 'pages-build-version':
        args.pagesBuildVersion = rawValue;
        break;
      case 'poll-interval-ms':
        args.pollIntervalMs = Number.parseInt(rawValue, 10);
        break;
      case 'timeout-ms':
        args.timeoutMs = Number.parseInt(rawValue, 10);
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.artifactName) {
    throw new Error('--artifact-name is required');
  }

  if (!args.pagesBuildVersion) {
    throw new Error('--pages-build-version is required');
  }

  if (!Number.isInteger(args.pollIntervalMs) || args.pollIntervalMs <= 0) {
    throw new Error('--poll-interval-ms must be a positive integer');
  }

  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  return args;
}

function appendOutput(outputFile, key, value) {
  if (!outputFile) {
    return;
  }

  fs.appendFileSync(outputFile, `${key}=${value}\n`);
}

function buildApiUrl(apiBaseUrl, pathname, query = {}) {
  const url = new URL(pathname, apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`);
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

async function fetchJson({
  body,
  fetchImpl = fetch,
  method = 'GET',
  token,
  url,
}) {
  const response = await fetchImpl(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': body === undefined ? undefined : 'application/json',
      'User-Agent': 'alt-text-generator-pages-deploy',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    method,
    redirect: 'follow',
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed with status ${response.status}: ${text.trim() || '<empty>'}`,
    );
  }

  return text ? JSON.parse(text) : {};
}

async function getOidcToken({
  audience,
  fetchImpl = fetch,
  requestToken,
  requestUrl,
}) {
  const url = new URL(requestUrl);
  url.searchParams.set('audience', audience);

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${requestToken}`,
      'User-Agent': 'alt-text-generator-pages-deploy',
    },
    redirect: 'follow',
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `OIDC token request failed with status ${response.status}: ${text.trim() || '<empty>'}`,
    );
  }

  const payload = text ? JSON.parse(text) : {};
  if (!payload.value) {
    throw new Error('OIDC token request did not return a token value');
  }

  return payload.value;
}

async function listRunArtifacts({
  apiBaseUrl,
  fetchImpl = fetch,
  repo,
  runId,
  token,
}) {
  const artifacts = [];
  let page = 1;

  for (;;) {
    // The next page depends on the previous response metadata.
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchJson({
      fetchImpl,
      token,
      url: buildApiUrl(apiBaseUrl, `/repos/${repo}/actions/runs/${runId}/artifacts`, {
        page: String(page),
        per_page: '100',
      }),
    });

    const nextArtifacts = Array.isArray(response.artifacts) ? response.artifacts : [];
    artifacts.push(...nextArtifacts);

    if (nextArtifacts.length === 0 || nextArtifacts.length < 100) {
      return artifacts;
    }

    page += 1;
  }
}

function selectArtifact({
  artifactName,
  artifacts,
}) {
  const matches = artifacts
    .filter((artifact) => artifact?.name === artifactName && !artifact.expired)
    .sort((left, right) => {
      const createdDelta = new Date(right.created_at || 0) - new Date(left.created_at || 0);
      if (createdDelta !== 0) {
        return createdDelta;
      }
      return Number(right.id || 0) - Number(left.id || 0);
    });

  if (matches.length === 0) {
    throw new Error(`No non-expired artifact named "${artifactName}" was found for this workflow run.`);
  }

  return matches[0];
}

async function createPagesDeployment({
  apiBaseUrl,
  artifactId,
  environment,
  fetchImpl = fetch,
  oidcToken,
  pagesBuildVersion,
  repo,
  token,
}) {
  return fetchJson({
    body: {
      artifact_id: artifactId,
      environment,
      oidc_token: oidcToken,
      pages_build_version: pagesBuildVersion,
    },
    fetchImpl,
    method: 'POST',
    token,
    url: buildApiUrl(apiBaseUrl, `/repos/${repo}/pages/deployments`),
  });
}

function normalizePageUrl(pageUrl) {
  if (!pageUrl) {
    return '';
  }

  return /^https?:\/\//u.test(pageUrl) ? pageUrl : `https://${pageUrl}`;
}

function sleep(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

async function waitForDeployment({
  fetchImpl = fetch,
  pollIntervalMs,
  sleepImpl = sleep,
  statusUrl,
  timeoutMs,
  token,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'unknown';

  while (Date.now() <= deadline) {
    // Polling must remain sequential so each status check observes the latest state.
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchJson({
      fetchImpl,
      token,
      url: statusUrl,
    });
    const status = typeof response.status === 'string' ? response.status : 'unknown';
    lastStatus = status;

    if (status === 'succeed' || status === 'success') {
      return response;
    }

    if (['cancelled', 'canceled', 'errored', 'error', 'failed', 'failure'].includes(status)) {
      throw new Error(`GitHub Pages deployment failed with status ${status}`);
    }

    // Sleep between polls to avoid hammering the Pages status endpoint.
    // eslint-disable-next-line no-await-in-loop
    await sleepImpl(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for GitHub Pages deployment. Last status: ${lastStatus}`);
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

async function deployPagesArtifact(options, env = process.env, helpers = {}) {
  const fetchImpl = helpers.fetchImpl || fetch;
  const sleepImpl = helpers.sleepImpl || sleep;
  const repository = requireEnv(env, 'GITHUB_REPOSITORY');
  const runId = requireEnv(env, 'GITHUB_RUN_ID');
  const token = requireEnv(env, 'GITHUB_TOKEN');
  const oidcRequestToken = requireEnv(env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN');
  const oidcRequestUrl = requireEnv(env, 'ACTIONS_ID_TOKEN_REQUEST_URL');
  const oidcAudience = `https://github.com/${repository}`;

  const artifacts = await listRunArtifacts({
    apiBaseUrl: options.apiBaseUrl,
    fetchImpl,
    repo: repository,
    runId,
    token,
  });
  const artifact = selectArtifact({
    artifactName: options.artifactName,
    artifacts,
  });
  const oidcToken = await getOidcToken({
    audience: oidcAudience,
    fetchImpl,
    requestToken: oidcRequestToken,
    requestUrl: oidcRequestUrl,
  });
  const deployment = await createPagesDeployment({
    apiBaseUrl: options.apiBaseUrl,
    artifactId: artifact.id,
    environment: options.environment,
    fetchImpl,
    oidcToken,
    pagesBuildVersion: options.pagesBuildVersion,
    repo: repository,
    token,
  });

  if (!deployment.status_url) {
    throw new Error('GitHub Pages deployment response did not include a status_url');
  }

  const completedDeployment = await waitForDeployment({
    fetchImpl,
    pollIntervalMs: options.pollIntervalMs,
    sleepImpl,
    statusUrl: deployment.status_url,
    timeoutMs: options.timeoutMs,
    token,
  });

  return {
    artifactId: artifact.id,
    deploymentId: deployment.id,
    pageUrl: normalizePageUrl(deployment.page_url || completedDeployment.page_url),
    status: completedDeployment.status,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await deployPagesArtifact(options);

  appendOutput(options.outputFile, 'artifact_id', result.artifactId);
  appendOutput(options.outputFile, 'deployment_id', result.deploymentId);
  appendOutput(options.outputFile, 'page_url', result.pageUrl);
  appendOutput(options.outputFile, 'status', result.status);

  // eslint-disable-next-line no-console
  console.log(
    `Published GitHub Pages artifact ${result.artifactId} as deployment ${result.deploymentId}`
      + ` with status ${result.status}.`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  buildApiUrl,
  createPagesDeployment,
  deployPagesArtifact,
  getOidcToken,
  listRunArtifacts,
  normalizePageUrl,
  parseArgs,
  selectArtifact,
  waitForDeployment,
};
