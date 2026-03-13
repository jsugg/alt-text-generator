const fs = require('node:fs');

const SEVERITIES = ['critical', 'high', 'moderate', 'low'];
const DEFAULT_API_BASE_URL = 'https://api.github.com/';
const DEFAULT_FAIL_ON_SEVERITY = 'low';
const DEFAULT_FAIL_ON_SCOPES = ['runtime'];
const DEFAULT_PER_PAGE = 100;

function parseArgs(argv) {
  const args = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    failOnScopes: [...DEFAULT_FAIL_ON_SCOPES],
    failOnSeverity: DEFAULT_FAIL_ON_SEVERITY,
    perPage: DEFAULT_PER_PAGE,
    summaryFile: process.env.GITHUB_STEP_SUMMARY || null,
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
      case 'base-ref':
        args.baseRef = rawValue;
        break;
      case 'fail-on-scopes':
        args.failOnScopes = rawValue.split(',').map((scope) => scope.trim()).filter(Boolean);
        break;
      case 'fail-on-severity':
        args.failOnSeverity = rawValue;
        break;
      case 'head-ref':
        args.headRef = rawValue;
        break;
      case 'per-page':
        args.perPage = Number.parseInt(rawValue, 10);
        break;
      case 'repo':
        args.repo = rawValue;
        break;
      case 'summary-file':
        args.summaryFile = rawValue;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.repo || !args.baseRef || !args.headRef) {
    throw new Error('--repo, --base-ref, and --head-ref are required');
  }

  if (!SEVERITIES.includes(args.failOnSeverity)) {
    throw new Error(`--fail-on-severity must be one of: ${SEVERITIES.join(', ')}`);
  }

  if (!Number.isInteger(args.perPage) || args.perPage <= 0 || args.perPage > 100) {
    throw new Error('--per-page must be a positive integer up to 100');
  }

  return args;
}

function requireEnv(name, env = process.env) {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function buildApiUrl({
  apiBaseUrl,
  repo,
  baseRef,
  headRef,
  page,
  perPage,
}) {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error('--repo must use the format <owner>/<repo>');
  }

  const url = new URL(
    `repos/${owner}/${repoName}/dependency-graph/compare/${encodeURIComponent(`${baseRef}...${headRef}`)}`,
    apiBaseUrl,
  );

  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));

  return url;
}

async function fetchGitHubJson({ fetchImpl = fetch, token, url }) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'alt-text-generator-dependency-review',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    method: 'GET',
    redirect: 'follow',
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed with status ${response.status}: ${text.trim() || '<empty>'}`,
    );
  }

  return {
    data: text ? JSON.parse(text) : [],
    headers: response.headers,
  };
}

function decodeSnapshotWarnings(headers) {
  const rawValue = headers?.get?.('x-github-dependency-graph-snapshot-warnings');

  if (!rawValue) {
    return '';
  }

  return Buffer.from(rawValue, 'base64').toString('utf8');
}

async function listDependencyChanges(args, { fetchImpl = fetch, token }) {
  const changes = [];
  let page = 1;
  let hasMorePages = true;
  let snapshotWarnings = '';

  while (hasMorePages) {
    // Dependency review pagination is sequential because each page depends
    // on the previous page boundary.
    // eslint-disable-next-line no-await-in-loop
    const { data, headers } = await fetchGitHubJson({
      fetchImpl,
      token,
      url: buildApiUrl({
        apiBaseUrl: args.apiBaseUrl,
        baseRef: args.baseRef,
        headRef: args.headRef,
        page,
        perPage: args.perPage,
        repo: args.repo,
      }),
    });

    if (!Array.isArray(data)) {
      throw new Error('Dependency review API returned a non-array payload');
    }

    const currentSnapshotWarnings = decodeSnapshotWarnings(headers);

    if (currentSnapshotWarnings) {
      snapshotWarnings = currentSnapshotWarnings;
    }

    changes.push(...data);
    hasMorePages = data.length === args.perPage;
    page += 1;
  }

  return {
    changes,
    snapshotWarnings,
  };
}

function filterChangesByScopes(scopes, changes) {
  return changes.filter((change) => scopes.includes(change.scope || 'runtime'));
}

function filterChangesBySeverity(severity, changes) {
  const severityIndex = SEVERITIES.indexOf(severity);

  return changes
    .filter((change) => change.change_type === 'added' && Array.isArray(change.vulnerabilities))
    .map((change) => ({
      ...change,
      vulnerabilities: change.vulnerabilities.filter((vulnerability) => (
        SEVERITIES.indexOf(vulnerability.severity) <= severityIndex
      )),
    }))
    .filter((change) => change.vulnerabilities.length > 0);
}

function appendStepSummary(summaryFile, content) {
  if (!summaryFile) {
    return;
  }

  fs.appendFileSync(summaryFile, `${content}\n`, 'utf8');
}

function formatVulnerabilitySummary(vulnerableChanges, severity) {
  const noVulnerabilityMessage = [
    'No added dependencies introduced vulnerabilities with severity',
    `\`${severity}\` or higher in the configured scopes.`,
  ].join(' ');

  if (vulnerableChanges.length === 0) {
    return [
      '### Dependency Review',
      '',
      noVulnerabilityMessage,
    ].join('\n');
  }

  const lines = [
    '### Dependency Review',
    '',
    `Detected ${vulnerableChanges.length} added dependency change(s) with vulnerabilities at severity \`${severity}\` or higher:`,
    '',
  ];

  vulnerableChanges.forEach((change) => {
    const advisories = change.vulnerabilities
      .map((vulnerability) => `${vulnerability.advisory_ghsa_id} (${vulnerability.severity})`)
      .join(', ');

    lines.push(`- \`${change.manifest}\` \`${change.name}@${change.version}\` [${change.scope || 'runtime'}]: ${advisories}`);
  });

  return lines.join('\n');
}

async function reviewDependencies(args, env = process.env, { fetchImpl = fetch } = {}) {
  const token = requireEnv('GITHUB_TOKEN', env);
  const { changes, snapshotWarnings } = await listDependencyChanges(args, {
    fetchImpl,
    token,
  });

  if (snapshotWarnings.trim()) {
    console.warn(snapshotWarnings);
  }

  if (changes.length === 0) {
    const summary = formatVulnerabilitySummary([], args.failOnSeverity);

    console.log('No dependency changes found.');
    appendStepSummary(args.summaryFile, summary);
    return {
      changes,
      vulnerableChanges: [],
    };
  }

  const scopedChanges = filterChangesByScopes(args.failOnScopes, changes);
  const vulnerableChanges = filterChangesBySeverity(args.failOnSeverity, scopedChanges);
  const summary = formatVulnerabilitySummary(vulnerableChanges, args.failOnSeverity);

  appendStepSummary(args.summaryFile, summary);

  if (vulnerableChanges.length === 0) {
    console.log(
      `Dependency review did not detect added vulnerabilities with severity "${args.failOnSeverity}" or higher.`,
    );

    return {
      changes,
      vulnerableChanges,
    };
  }

  vulnerableChanges.forEach((change) => {
    change.vulnerabilities.forEach((vulnerability) => {
      console.error(
        `${change.manifest} » ${change.name}@${change.version} [${change.scope || 'runtime'}] – `
        + `${vulnerability.advisory_summary} (${vulnerability.severity})`,
      );
      console.error(`  ↪ ${vulnerability.advisory_url}`);
    });
  });

  throw new Error('Dependency review detected vulnerable packages.');
}

async function main() {
  await reviewDependencies(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  appendStepSummary,
  buildApiUrl,
  fetchGitHubJson,
  filterChangesByScopes,
  filterChangesBySeverity,
  formatVulnerabilitySummary,
  listDependencyChanges,
  parseArgs,
  reviewDependencies,
};
