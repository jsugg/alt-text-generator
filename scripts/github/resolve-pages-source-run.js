#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string[]} argv
 * @returns {{ githubOutput: string }}
 */
function parseArgs(argv) {
  let githubOutput = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--github-output') {
      githubOutput = argv[index + 1] || null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!githubOutput) {
    throw new Error('Missing required argument: --github-output <path>');
  }

  return {
    githubOutput,
  };
}

/**
 * @param {string} eventPath
 * @returns {Record<string, unknown>}
 */
function readEventPayload(eventPath) {
  const resolvedEventPath = path.resolve(process.cwd(), eventPath);
  return JSON.parse(fs.readFileSync(resolvedEventPath, 'utf8'));
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
 *   fetchImpl?: typeof fetch,
 *   repository?: string,
 *   runId: string,
 *   token?: string,
 *   apiBaseUrl?: string,
 * }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchWorkflowRun({
  apiBaseUrl = process.env.GITHUB_API_URL || 'https://api.github.com/',
  fetchImpl = fetch,
  repository = process.env.GITHUB_REPOSITORY || '',
  runId,
  token = process.env.GITHUB_TOKEN || '',
}) {
  if (!repository) {
    throw new Error('Missing required environment variable: GITHUB_REPOSITORY');
  }

  if (!token) {
    throw new Error('Missing required environment variable: GITHUB_TOKEN');
  }

  const response = await fetchImpl(buildApiUrl(apiBaseUrl, `/repos/${repository}/actions/runs/${runId}`), {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'alt-text-generator-pages-source-run',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    method: 'GET',
    redirect: 'follow',
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`GitHub workflow run lookup failed with status ${response.status}: ${text.trim() || '<empty>'}`);
  }

  return text ? JSON.parse(text) : {};
}

/**
 * @param {{
 *   apiBaseUrl?: string,
 *   dispatchRunId?: string,
 *   eventName?: string,
 *   eventPayload?: Record<string, unknown>,
 *   fetchImpl?: typeof fetch,
 *   repository?: string,
 *   token?: string,
 * }} options
 * @returns {Promise<{
 *   headSha: string,
 *   runId: string,
 *   sourceEvent: string,
 *   workflowConclusion: string,
 * }>}
 */
async function resolveSourceRun({
  apiBaseUrl = process.env.GITHUB_API_URL || 'https://api.github.com/',
  dispatchRunId = '',
  eventName = process.env.GITHUB_EVENT_NAME || '',
  eventPayload = readEventPayload(process.env.GITHUB_EVENT_PATH || ''),
  fetchImpl = fetch,
  repository = process.env.GITHUB_REPOSITORY || '',
  token = process.env.GITHUB_TOKEN || '',
} = {}) {
  const workflowRun = eventPayload.workflow_run || {};
  const resolvedDispatchRunId = dispatchRunId.trim();

  if (eventName === 'workflow_dispatch') {
    if (!resolvedDispatchRunId) {
      throw new Error('Unable to resolve the source CI workflow run ID');
    }

    const sourceWorkflowRun = await fetchWorkflowRun({
      apiBaseUrl,
      fetchImpl,
      repository,
      runId: resolvedDispatchRunId,
      token,
    });

    return {
      headSha: String(sourceWorkflowRun.head_sha || '').trim(),
      runId: resolvedDispatchRunId,
      sourceEvent: String(sourceWorkflowRun.event || 'workflow_dispatch').trim(),
      workflowConclusion: String(sourceWorkflowRun.conclusion || '').trim(),
    };
  }

  const runId = String(workflowRun.id || '').trim();

  if (!runId) {
    throw new Error('Unable to resolve the source CI workflow run ID');
  }

  return {
    headSha: String(workflowRun.head_sha || '').trim(),
    runId,
    sourceEvent: String(workflowRun.event || eventName).trim(),
    workflowConclusion: String(workflowRun.conclusion || '').trim(),
  };
}

/**
 * @param {{
 *   githubOutput: string,
 *   sourceRun: {
 *     headSha: string,
 *     runId: string,
 *     sourceEvent: string,
 *     workflowConclusion: string,
 *   },
 * }} options
 * @returns {void}
 */
function writeGitHubOutputs({
  githubOutput,
  sourceRun,
}) {
  fs.appendFileSync(githubOutput, `run_id=${sourceRun.runId}\n`);
  fs.appendFileSync(githubOutput, `source_event=${sourceRun.sourceEvent}\n`);
  fs.appendFileSync(githubOutput, `workflow_conclusion=${sourceRun.workflowConclusion}\n`);
  fs.appendFileSync(githubOutput, `head_sha=${sourceRun.headSha}\n`);
}

/**
 * @param {{
 *   argv?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 * @returns {Promise<void>}
 */
async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const { githubOutput } = parseArgs(argv);
  const sourceRun = await resolveSourceRun({
    apiBaseUrl: env.GITHUB_API_URL || 'https://api.github.com/',
    dispatchRunId: env.DISPATCH_RUN_ID || '',
    eventName: env.GITHUB_EVENT_NAME || '',
    eventPayload: readEventPayload(env.GITHUB_EVENT_PATH || ''),
    fetchImpl,
    repository: env.GITHUB_REPOSITORY || '',
    token: env.GITHUB_TOKEN || '',
  });

  writeGitHubOutputs({
    githubOutput,
    sourceRun,
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
  fetchWorkflowRun,
  main,
  parseArgs,
  readEventPayload,
  resolveSourceRun,
  writeGitHubOutputs,
};
