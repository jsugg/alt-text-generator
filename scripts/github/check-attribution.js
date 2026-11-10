#!/usr/bin/env node

/**
 * Attribution Guard: fails when AI-tool attribution appears in pull-request
 * metadata (title, body, head ref, labels) or in commits (message, author and
 * committer email). Metadata is refetched from the API at run time rather than
 * trusted from the event payload, so `edited` / `labeled` re-runs see the
 * current state. No actor is exempt; bot commits pass on content.
 */

const {
  COMMIT_MESSAGE_RE,
  EMAIL_RE,
  LABEL_RE,
  REF_NAME_RE,
} = require('./attribution-patterns');

const PAGE_SIZE = 100;
const EXCERPT_LENGTH = 120;
const ZERO_SHA_PATTERN = /^0+$/u;

/**
 * @typedef {object} Violation
 * @property {string} field
 * @property {string} rule
 * @property {string} excerpt
 */

/**
 * @typedef {object} CommitRecord
 * @property {string} sha
 * @property {string} message
 * @property {string|null} authorEmail
 * @property {string|null} committerEmail
 */

/**
 * @typedef {object} PullRequestRecord
 * @property {number} number
 * @property {string} title
 * @property {string} body
 * @property {string} headRef
 * @property {string[]} labels
 */

/**
 * @typedef {(path: string) => Promise<unknown>} ApiGet
 */

/**
 * Escapes text for a workflow command so matched user content cannot inject
 * further commands or break the annotation.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeWorkflowCommandData(value) {
  return value.replace(/%/gu, '%25').replace(/\r/gu, '%0D').replace(/\n/gu, '%0A');
}

/**
 * @param {string} rule
 * @param {RegExp} pattern
 * @param {string} field
 * @param {string|null|undefined} value
 * @returns {Violation[]}
 */
function matchField(rule, pattern, field, value) {
  if (!value) {
    return [];
  }

  const match = value.match(pattern);

  if (!match) {
    return [];
  }

  return [{
    field,
    rule,
    excerpt: match[0].trim().slice(0, EXCERPT_LENGTH),
  }];
}

/**
 * @param {CommitRecord} commit
 * @returns {Violation[]}
 */
function findCommitViolations(commit) {
  const prefix = `commit ${commit.sha.slice(0, 12)}`;

  return [
    ...matchField('COMMIT_MESSAGE', COMMIT_MESSAGE_RE, `${prefix} message`, commit.message),
    ...matchField('EMAIL', EMAIL_RE, `${prefix} author email`, commit.authorEmail),
    ...matchField('EMAIL', EMAIL_RE, `${prefix} committer email`, commit.committerEmail),
  ];
}

/**
 * @param {PullRequestRecord} pullRequest
 * @param {CommitRecord[]} commits
 * @returns {Violation[]}
 */
function findPullRequestViolations(pullRequest, commits) {
  const prefix = `pull request #${pullRequest.number}`;

  return [
    ...matchField('COMMIT_MESSAGE', COMMIT_MESSAGE_RE, `${prefix} title`, pullRequest.title),
    ...matchField('COMMIT_MESSAGE', COMMIT_MESSAGE_RE, `${prefix} body`, pullRequest.body),
    ...matchField('REF_NAME', REF_NAME_RE, `${prefix} head ref`, pullRequest.headRef),
    ...pullRequest.labels.flatMap((label) => (
      matchField('LABEL', LABEL_RE, `${prefix} label "${label}"`, label)
    )),
    ...commits.flatMap(findCommitViolations),
  ];
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unexpected GitHub API response shape');
  }

  return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {unknown} value
 * @returns {CommitRecord}
 */
function toCommitRecord(value) {
  const entry = asRecord(value);
  const commit = asRecord(entry.commit);

  return {
    sha: String(entry.sha),
    message: typeof commit.message === 'string' ? commit.message : '',
    authorEmail: commit.author?.email ?? null,
    committerEmail: commit.committer?.email ?? null,
  };
}

/**
 * Collects every page of a list endpoint (or of a list nested under `key`).
 * Pages are fetched in order because each one decides whether another follows.
 *
 * @param {ApiGet} apiGet
 * @param {string} path
 * @param {string} [key]
 * @param {number} [page]
 * @returns {Promise<unknown[]>}
 */
async function listAllPages(apiGet, path, key, page = 1) {
  const separator = path.includes('?') ? '&' : '?';
  const payload = await apiGet(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`);
  const batch = key ? asRecord(payload)[key] : payload;

  if (!Array.isArray(batch)) {
    throw new Error(`Expected a list from ${path}`);
  }

  if (batch.length < PAGE_SIZE) {
    return batch;
  }

  return [...batch, ...await listAllPages(apiGet, path, key, page + 1)];
}

/**
 * @param {ApiGet} apiGet
 * @param {string} repo
 * @param {number} number
 * @returns {Promise<{ pullRequest: PullRequestRecord, commits: CommitRecord[] }>}
 */
async function loadPullRequest(apiGet, repo, number) {
  const pull = asRecord(await apiGet(`/repos/${repo}/pulls/${number}`));
  const commits = await listAllPages(apiGet, `/repos/${repo}/pulls/${number}/commits`);

  return {
    pullRequest: {
      number,
      title: typeof pull.title === 'string' ? pull.title : '',
      body: typeof pull.body === 'string' ? pull.body : '',
      headRef: String(asRecord(pull.head).ref),
      labels: (Array.isArray(pull.labels) ? pull.labels : [])
        .map((label) => String(asRecord(label).name)),
    },
    commits: commits.map(toCommitRecord),
  };
}

/**
 * @param {ApiGet} apiGet
 * @param {string} repo
 * @param {string} before
 * @param {string} after
 * @returns {Promise<CommitRecord[]>}
 */
async function loadPushedCommits(apiGet, repo, before, after) {
  if (ZERO_SHA_PATTERN.test(before)) {
    return [toCommitRecord(await apiGet(`/repos/${repo}/commits/${after}`))];
  }

  const commits = await listAllPages(
    apiGet,
    `/repos/${repo}/compare/${before}...${after}`,
    'commits',
  );

  return commits.map(toCommitRecord);
}

/**
 * @param {string} token
 * @param {string} [apiUrl]
 * @param {typeof fetch} [fetchImpl]
 * @returns {ApiGet}
 */
function createApiGet(token, apiUrl = 'https://api.github.com', fetchImpl = fetch) {
  return async (path) => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API ${path} responded ${response.status}`);
    }

    return response.json();
  };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @returns {string}
 */
function requireEnv(env, name) {
  const value = env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {ApiGet} apiGet
 * @returns {Promise<{ scope: string, violations: Violation[] }>}
 */
async function evaluateEvent(env, apiGet) {
  const eventName = requireEnv(env, 'GITHUB_EVENT_NAME');
  const repo = requireEnv(env, 'GITHUB_REPOSITORY');

  if (eventName === 'pull_request') {
    const number = Number.parseInt(requireEnv(env, 'PR_NUMBER'), 10);
    const { pullRequest, commits } = await loadPullRequest(apiGet, repo, number);

    return {
      scope: `pull request #${number} (${commits.length} commit(s))`,
      violations: findPullRequestViolations(pullRequest, commits),
    };
  }

  if (eventName === 'push') {
    const ref = requireEnv(env, 'GITHUB_REF');
    const commits = await loadPushedCommits(
      apiGet,
      repo,
      requireEnv(env, 'PUSH_BEFORE'),
      requireEnv(env, 'PUSH_AFTER'),
    );

    return {
      scope: `push to ${ref} (${commits.length} commit(s))`,
      violations: [
        ...matchField('REF_NAME', REF_NAME_RE, 'pushed ref', ref),
        ...commits.flatMap(findCommitViolations),
      ],
    };
  }

  throw new Error(`Unsupported event: ${eventName}`);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {ApiGet} [apiGet]
 * @param {(line: string) => void} [writeLine]
 * @returns {Promise<number>}
 */
async function main(
  env = process.env,
  apiGet = createApiGet(requireEnv(env, 'GITHUB_TOKEN'), env.GITHUB_API_URL),
  writeLine = (line) => process.stdout.write(`${line}\n`),
) {
  const { scope, violations } = await evaluateEvent(env, apiGet);

  if (violations.length === 0) {
    writeLine(`Attribution Guard OK: ${scope}`);
    return 0;
  }

  writeLine(`Attribution Guard FAILED: ${scope}`);
  violations.forEach(({ field, rule, excerpt }) => {
    writeLine(`::error::${escapeWorkflowCommandData(`${field} matches ${rule}: "${excerpt}"`)}`);
  });

  return 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }, (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createApiGet,
  evaluateEvent,
  findCommitViolations,
  findPullRequestViolations,
  listAllPages,
  loadPullRequest,
  loadPushedCommits,
  main,
};
