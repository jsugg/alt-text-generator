#!/usr/bin/env node

/**
 * @param {string[]} argv
 * @returns {{
 *   apiBaseUrl: string,
 *   ref: string,
 *   repo: string,
 *   runId: string,
 *   workflow: string,
 * }}
 */
function parseArgs(argv) {
  const args = {
    apiBaseUrl: process.env.GITHUB_API_URL || 'https://api.github.com/',
    ref: 'main',
    repo: process.env.GITHUB_REPOSITORY || '',
    runId: '',
    workflow: 'allure-pages-publish.yml',
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
      case 'ref':
        args.ref = rawValue;
        break;
      case 'repo':
        args.repo = rawValue;
        break;
      case 'run-id':
        args.runId = rawValue;
        break;
      case 'workflow':
        args.workflow = rawValue;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.repo || !args.runId.trim()) {
    throw new Error('--repo and --run-id are required');
  }

  return {
    ...args,
    apiBaseUrl: args.apiBaseUrl.endsWith('/') ? args.apiBaseUrl : `${args.apiBaseUrl}/`,
    runId: args.runId.trim(),
  };
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
 * @param {{
 *   body?: Record<string, unknown>,
 *   fetchImpl?: typeof fetch,
 *   method?: string,
 *   token: string,
 *   url: string,
 * }} options
 * @returns {Promise<void>}
 */
async function postGitHubJson({
  body = {},
  fetchImpl = fetch,
  method = 'POST',
  token,
  url,
}) {
  const response = await fetchImpl(url, {
    body: JSON.stringify(body),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'alt-text-generator-pages-publish-dispatch',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    method,
    redirect: 'follow',
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`GitHub workflow dispatch failed with status ${response.status}: ${text.trim() || '<empty>'}`);
  }
}

/**
 * @param {{
 *   apiBaseUrl: string,
 *   fetchImpl?: typeof fetch,
 *   ref: string,
 *   repo: string,
 *   runId: string,
 *   token: string,
 *   workflow: string,
 * }} options
 * @returns {Promise<void>}
 */
async function dispatchPagesPublish({
  apiBaseUrl,
  fetchImpl = fetch,
  ref,
  repo,
  runId,
  token,
  workflow,
}) {
  if (!token) {
    throw new Error('Missing required environment variable: GITHUB_TOKEN');
  }

  await postGitHubJson({
    body: {
      inputs: {
        run_id: runId,
      },
      ref,
    },
    fetchImpl,
    token,
    url: buildApiUrl(apiBaseUrl, `/repos/${repo}/actions/workflows/${workflow}/dispatches`),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await dispatchPagesPublish({
    ...options,
    token: process.env.GITHUB_TOKEN || '',
  });
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
  dispatchPagesPublish,
  parseArgs,
  postGitHubJson,
};
