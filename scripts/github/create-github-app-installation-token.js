#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');

/**
 * @typedef {object} ParsedArgs
 * @property {string} apiBaseUrl
 * @property {string|null} outputFile
 * @property {string} [appId]
 * @property {string} [owner]
 * @property {string} [repo]
 */

/**
 * ParsedArgs after validation guarantees app-id/owner/repo are present.
 * @typedef {ParsedArgs & { appId: string, owner: string, repo: string }} ValidatedArgs
 */

/**
 * @typedef {object} InstallationLookupResponse
 * @property {number} id
 */

/**
 * @typedef {object} InstallationTokenResponse
 * @property {string} token
 * @property {string} [expires_at]
 */

/**
 * @param {string[]} argv
 * @returns {ValidatedArgs}
 */
function parseArgs(argv) {
  const args = /** @type {ParsedArgs} */ ({
    apiBaseUrl: 'https://api.github.com/',
    outputFile: null,
  });

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
      case 'app-id':
        args.appId = rawValue;
        break;
      case 'owner':
        args.owner = rawValue;
        break;
      case 'output-file':
        args.outputFile = rawValue;
        break;
      case 'repo':
        args.repo = rawValue;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.appId || !args.owner || !args.repo) {
    throw new Error('--app-id, --owner, and --repo are required');
  }

  return /** @type {ValidatedArgs} */ (args);
}

/**
 * @param {string|null} outputFile
 * @param {string} key
 * @param {string|number} value
 * @returns {void}
 */
function appendOutput(outputFile, key, value) {
  if (!outputFile) {
    return;
  }

  fs.appendFileSync(outputFile, `${key}=${value}\n`);
}

/**
 * @param {string} privateKey
 * @returns {string}
 */
function normalizePrivateKey(privateKey) {
  return privateKey.includes('\n') ? privateKey : privateKey.replace(/\\n/gu, '\n');
}

/**
 * @param {string} value
 * @returns {string}
 */
function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

/**
 * @param {string} apiBaseUrl
 * @param {string} pathname
 * @returns {string}
 */
function buildApiUrl(apiBaseUrl, pathname) {
  return new URL(pathname, apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`).toString();
}

/**
 * @param {{ appId: string, nowMs?: number, privateKey: string }} params
 * @returns {string}
 */
function buildAppJwt({
  appId,
  nowMs = Date.now(),
  privateKey,
}) {
  const nowSeconds = Math.floor(nowMs / 1000);
  const header = base64UrlEncode(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
  }));
  const payload = base64UrlEncode(JSON.stringify({
    exp: nowSeconds + (9 * 60),
    iat: nowSeconds - 60,
    iss: appId,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(privateKey), 'base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * @param {{ body?: unknown, fetchImpl?: typeof fetch, method?: string, token: string, url: string }} params
 * @returns {Promise<unknown>}
 */
async function fetchGitHubJson({
  body,
  fetchImpl = fetch,
  method = 'GET',
  token,
  url,
}) {
  const headers = /** @type {Record<string, string>} */ ({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'alt-text-generator-github-app-token',
    'X-GitHub-Api-Version': '2022-11-28',
  });

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetchImpl(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
    redirect: 'follow',
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}: ${text.trim() || '<empty>'}`);
  }

  return text ? JSON.parse(text) : {};
}

/**
 * @param {{ apiBaseUrl: string, appJwt: string, fetchImpl?: typeof fetch, owner: string, repo: string }} params
 * @returns {Promise<number>}
 */
async function resolveInstallationId({
  apiBaseUrl,
  appJwt,
  fetchImpl = fetch,
  owner,
  repo,
}) {
  const response = /** @type {InstallationLookupResponse} */ (await fetchGitHubJson({
    fetchImpl,
    token: appJwt,
    url: buildApiUrl(apiBaseUrl, `/repos/${owner}/${repo}/installation`),
  }));

  if (!response.id) {
    throw new Error('GitHub App installation lookup did not return an installation id');
  }

  return response.id;
}

/**
 * @param {{ apiBaseUrl: string, appJwt: string, fetchImpl?: typeof fetch, installationId: number, repo: string }} params
 * @returns {Promise<InstallationTokenResponse>}
 */
async function createInstallationAccessToken({
  apiBaseUrl,
  appJwt,
  fetchImpl = fetch,
  installationId,
  repo,
}) {
  const response = /** @type {InstallationTokenResponse} */ (await fetchGitHubJson({
    body: {
      repositories: [repo],
    },
    fetchImpl,
    method: 'POST',
    token: appJwt,
    url: buildApiUrl(apiBaseUrl, `/app/installations/${installationId}/access_tokens`),
  }));

  if (!response.token) {
    throw new Error('GitHub App installation token response did not include a token');
  }

  return response;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} key
 * @returns {string}
 */
function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * @param {ValidatedArgs} options
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ fetchImpl?: typeof fetch, nowMs?: number }} [helpers]
 * @returns {Promise<{ expiresAt: string, installationId: number, token: string }>}
 */
async function createGitHubAppInstallationToken(options, env = process.env, helpers = {}) {
  const fetchImpl = helpers.fetchImpl || fetch;
  const privateKey = requireEnv(env, 'REPO_TOOLING_GITHUB_APP_PRIVATE_KEY');
  const appJwt = buildAppJwt({
    appId: options.appId,
    nowMs: helpers.nowMs,
    privateKey,
  });
  const installationId = await resolveInstallationId({
    apiBaseUrl: options.apiBaseUrl,
    appJwt,
    fetchImpl,
    owner: options.owner,
    repo: options.repo,
  });
  const accessToken = await createInstallationAccessToken({
    apiBaseUrl: options.apiBaseUrl,
    appJwt,
    fetchImpl,
    installationId,
    repo: options.repo,
  });

  return {
    expiresAt: accessToken.expires_at || '',
    installationId,
    token: accessToken.token,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = await createGitHubAppInstallationToken(options);

  // eslint-disable-next-line no-console
  console.log(`::add-mask::${token.token}`);
  appendOutput(options.outputFile, 'expires_at', token.expiresAt);
  appendOutput(options.outputFile, 'installation_id', token.installationId);
  appendOutput(options.outputFile, 'token', token.token);
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  appendOutput,
  buildAppJwt,
  buildApiUrl,
  createGitHubAppInstallationToken,
  createInstallationAccessToken,
  fetchGitHubJson,
  normalizePrivateKey,
  parseArgs,
  resolveInstallationId,
};
