#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DEPLOY_BASE_URL = 'https://wcag.qcraft.com.br';

/**
 * Normalizes a URL by trimming trailing slashes.
 *
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  return url.replace(/\/+$/u, '');
}

/**
 * Normalizes a Pages publish path by trimming leading/trailing slashes.
 *
 * @param {string} publishPath
 * @returns {string}
 */
function normalizePublishPath(publishPath) {
  return publishPath.replace(/^\/+|\/+$/gu, '');
}

/**
 * Builds a public Pages report URL for a publish path.
 *
 * @param {{
 *   pagesReportUrl: string,
 *   publishPath: string,
 * }} options
 * @returns {string}
 */
function buildPagesPathUrl({
  pagesReportUrl,
  publishPath,
}) {
  const normalizedBaseUrl = normalizeUrl(pagesReportUrl);
  const normalizedPublishPath = normalizePublishPath(publishPath);

  if (!normalizedBaseUrl) {
    return '';
  }

  if (!normalizedPublishPath) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/${normalizedPublishPath}`;
}

/**
 * Builds the public GitHub Pages report URL for the repository when possible.
 *
 * @param {{ repository?: string, serverUrl?: string }} options
 * @returns {string | null}
 */
function buildPagesReportUrl({
  repository = process.env.GITHUB_REPOSITORY,
  serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com',
} = {}) {
  if (!repository || serverUrl !== 'https://github.com') {
    return null;
  }

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    return null;
  }

  return `https://${owner}.github.io/${repo}`;
}

/**
 * Reads the GitHub event payload from disk.
 *
 * @param {string | null} eventPath
 * @returns {Record<string, unknown>}
 */
function readEventPayload(eventPath) {
  if (!eventPath) {
    return {};
  }

  const resolvedPath = path.resolve(process.cwd(), eventPath);
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{
 *   baseUrl: string | null,
 *   githubOutput: string | null,
 *   persistHistory: boolean,
 *   workflowKind: 'ci' | 'deploy',
 * }}
 */
function parseArgs(argv) {
  let workflowKind = null;
  let baseUrl = null;
  let githubOutput = null;
  let persistHistory = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--workflow-kind') {
      workflowKind = argv[index + 1] || null;
      index += 1;
    } else if (token === '--base-url') {
      baseUrl = argv[index + 1] || null;
      index += 1;
    } else if (token === '--github-output') {
      githubOutput = argv[index + 1] || null;
      index += 1;
    } else if (token === '--persist-history') {
      persistHistory = (argv[index + 1] || '').trim().toLowerCase() === 'true';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (workflowKind !== 'ci' && workflowKind !== 'deploy') {
    throw new Error('Expected --workflow-kind to be either "ci" or "deploy"');
  }

  return {
    baseUrl: baseUrl ? normalizeUrl(baseUrl) : null,
    githubOutput,
    persistHistory,
    workflowKind,
  };
}

/**
 * Resolves whether a pull request originates from the same repository.
 *
 * @param {{
 *   eventPayload?: Record<string, unknown>,
 *   repository?: string,
 * }} options
 * @returns {{ isSameRepo: boolean, pullRequestNumber: string | null }}
 */
function resolvePullRequestContext({
  eventPayload = {},
  repository = process.env.GITHUB_REPOSITORY || '',
} = {}) {
  const pullRequest = /** @type {{ number?: number, head?: { repo?: { full_name?: string } } }} */ (
    eventPayload.pull_request || {}
  );
  const pullRequestNumber = pullRequest.number ? String(pullRequest.number) : null;
  const headRepository = pullRequest.head?.repo?.full_name || '';

  return {
    isSameRepo: Boolean(repository && headRepository && repository === headRepository),
    pullRequestNumber,
  };
}

/**
 * Resolves the CI workflow policy.
 *
 * @param {{
 *   eventPayload?: Record<string, unknown>,
 *   repository?: string,
 *   serverUrl?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} options
 * @returns {{
 *   historyArtifactName: string,
 *   historyFallbackReportUrl: string,
 *   historyKey: string,
 *   historyRetentionDays: string,
 *   persistHistory: string,
 *   publishPages: string,
 *   reportKind: string,
 *   reportLabel: string,
 *   restoreHistory: string,
 * }}
 */
function resolveCiPolicy({
  eventPayload = {},
  repository = process.env.GITHUB_REPOSITORY,
  serverUrl = process.env.GITHUB_SERVER_URL,
  env = process.env,
} = {}) {
  const eventName = env.GITHUB_EVENT_NAME;
  const ref = env.GITHUB_REF;
  const pagesReportUrl = buildPagesReportUrl({ repository, serverUrl }) || '';

  if (eventName === 'push' && ref === 'refs/heads/main') {
    return {
      history_artifact_name: 'allure-history-ci-main',
      history_fallback_report_url: pagesReportUrl,
      history_key: 'ci-main',
      history_retention_days: '90',
      pages_path: '',
      pages_report_url: pagesReportUrl,
      persist_history: 'true',
      publish_pages: 'true',
      report_kind: 'ci-main',
      report_label: 'CI Main',
      restore_history: 'true',
    };
  }

  if (eventName === 'pull_request') {
    const { isSameRepo, pullRequestNumber } = resolvePullRequestContext({
      eventPayload,
      repository,
    });

    if (isSameRepo && pullRequestNumber) {
      const pagesPath = `pr/${pullRequestNumber}`;

      return {
        history_artifact_name: `allure-history-ci-pr-${pullRequestNumber}`,
        history_fallback_report_url: buildPagesPathUrl({
          pagesReportUrl,
          publishPath: pagesPath,
        }),
        history_key: `ci-pr-${pullRequestNumber}`,
        history_retention_days: '14',
        pages_path: pagesPath,
        pages_report_url: buildPagesPathUrl({
          pagesReportUrl,
          publishPath: pagesPath,
        }),
        persist_history: 'true',
        publish_pages: 'true',
        report_kind: 'ci-pr',
        report_label: `CI PR #${pullRequestNumber}`,
        restore_history: 'true',
      };
    }

    return {
      history_artifact_name: '',
      history_fallback_report_url: '',
      history_key: '',
      history_retention_days: '',
      pages_path: '',
      pages_report_url: '',
      persist_history: 'false',
      publish_pages: 'false',
      report_kind: 'ci-pr-external',
      report_label: 'CI External PR',
      restore_history: 'false',
    };
  }

  if (eventName === 'push' && ref === 'refs/heads/production') {
    return {
      history_artifact_name: '',
      history_fallback_report_url: '',
      history_key: '',
      history_retention_days: '',
      pages_path: '',
      pages_report_url: '',
      persist_history: 'false',
      publish_pages: 'false',
      report_kind: 'ci-production',
      report_label: 'CI Production Branch',
      restore_history: 'false',
    };
  }

  return {
    history_artifact_name: '',
    history_fallback_report_url: '',
    history_key: '',
    history_retention_days: '',
    pages_path: '',
    pages_report_url: '',
    persist_history: 'false',
    publish_pages: 'false',
    report_kind: 'ci-other',
    report_label: 'CI',
    restore_history: 'false',
  };
}

/**
 * Resolves the deploy verification workflow policy.
 *
 * @param {{
 *   baseUrl: string | null,
 *   env?: NodeJS.ProcessEnv,
 *   persistHistory?: boolean,
 * }} options
 * @returns {{
 *   historyArtifactName: string,
 *   historyFallbackReportUrl: string,
 *   historyKey: string,
 *   historyRetentionDays: string,
 *   persistHistory: string,
 *   publishPages: string,
 *   reportKind: string,
 *   reportLabel: string,
 *   restoreHistory: string,
 * }}
 */
function resolveDeployPolicy({
  baseUrl,
  env = process.env,
  persistHistory = false,
} = {}) {
  const canonicalBaseUrl = normalizeUrl(DEFAULT_DEPLOY_BASE_URL);
  const normalizedBaseUrl = baseUrl ? normalizeUrl(baseUrl) : canonicalBaseUrl;
  const isCanonicalBaseUrl = normalizedBaseUrl === canonicalBaseUrl;

  if (env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/production') {
    return {
      history_artifact_name: 'allure-history-deploy-production',
      history_fallback_report_url: '',
      history_key: 'deploy-production',
      history_retention_days: '60',
      pages_path: '',
      pages_report_url: '',
      persist_history: 'true',
      publish_pages: 'false',
      report_kind: 'deploy-production',
      report_label: 'Post Deploy Verification Production',
      restore_history: 'true',
    };
  }

  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && isCanonicalBaseUrl && persistHistory) {
    return {
      history_artifact_name: 'allure-history-deploy-production',
      history_fallback_report_url: '',
      history_key: 'deploy-production',
      history_retention_days: '60',
      pages_path: '',
      pages_report_url: '',
      persist_history: 'true',
      publish_pages: 'false',
      report_kind: 'deploy-production',
      report_label: 'Post Deploy Verification Production',
      restore_history: 'true',
    };
  }

  return {
    history_artifact_name: '',
    history_fallback_report_url: '',
    history_key: '',
    history_retention_days: '',
    pages_path: '',
    pages_report_url: '',
    persist_history: 'false',
    publish_pages: 'false',
    report_kind: isCanonicalBaseUrl ? 'deploy-manual' : 'deploy-custom',
    report_label: isCanonicalBaseUrl
      ? 'Post Deploy Verification Manual'
      : 'Post Deploy Verification Custom URL',
    restore_history: 'false',
  };
}

/**
 * Serializes key/value outputs for GitHub Actions.
 *
 * @param {Record<string, string>} values
 * @returns {string}
 */
function toOutputLines(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

/**
 * Resolves the complete policy for the workflow.
 *
 * @param {{
 *   baseUrl: string | null,
 *   eventPayload?: Record<string, unknown>,
 *   persistHistory: boolean,
 *   workflowKind: 'ci' | 'deploy',
 *   env?: NodeJS.ProcessEnv,
 * }} options
 * @returns {Record<string, string>}
 */
function resolveAllureHistoryPolicy({
  baseUrl,
  eventPayload = {},
  persistHistory = false,
  workflowKind,
  env = process.env,
} = {}) {
  if (workflowKind === 'deploy') {
    return resolveDeployPolicy({
      baseUrl,
      env,
      persistHistory,
    });
  }

  return resolveCiPolicy({
    eventPayload,
    env,
    repository: env.GITHUB_REPOSITORY,
    serverUrl: env.GITHUB_SERVER_URL,
  });
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const eventPayload = readEventPayload(process.env.GITHUB_EVENT_PATH || null);
  const policy = resolveAllureHistoryPolicy({
    baseUrl: options.baseUrl,
    eventPayload,
    persistHistory: options.persistHistory,
    workflowKind: options.workflowKind,
  });
  const serializedPolicy = toOutputLines(policy);

  if (options.githubOutput) {
    fs.appendFileSync(options.githubOutput, serializedPolicy, 'utf8');
  }

  process.stdout.write(serializedPolicy);
}

module.exports = {
  DEFAULT_DEPLOY_BASE_URL,
  buildPagesReportUrl,
  buildPagesPathUrl,
  normalizeUrl,
  normalizePublishPath,
  parseArgs,
  readEventPayload,
  resolveAllureHistoryPolicy,
  resolveCiPolicy,
  resolveDeployPolicy,
  resolvePullRequestContext,
  toOutputLines,
};
