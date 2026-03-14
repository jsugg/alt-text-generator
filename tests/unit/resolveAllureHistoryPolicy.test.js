const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_DEPLOY_BASE_URL,
  buildPagesPathUrl,
  buildPagesReportUrl,
  normalizeUrl,
  normalizePublishPath,
  parseArgs,
  readEventPayload,
  resolveAllureHistoryPolicy,
  resolvePullRequestContext,
} = require('../../scripts/reporting/resolve-allure-history-policy');

describe('Unit | Allure History Policy', () => {
  it('normalizes URLs and parses CLI arguments', () => {
    expect(normalizeUrl('https://jsugg.github.io/alt-text-generator///')).toBe(
      'https://jsugg.github.io/alt-text-generator',
    );

    expect(parseArgs([
      '--workflow-kind',
      'deploy',
      '--base-url',
      'https://wcag.qcraft.com.br/',
      '--persist-history',
      'true',
    ])).toEqual({
      baseUrl: 'https://wcag.qcraft.com.br',
      githubOutput: null,
      persistHistory: true,
      workflowKind: 'deploy',
    });
  });

  it('builds the GitHub Pages report URL for public GitHub repositories', () => {
    expect(buildPagesReportUrl({
      repository: 'jsugg/alt-text-generator',
      serverUrl: 'https://github.com',
    })).toBe('https://jsugg.github.io/alt-text-generator');
  });

  it('builds report URLs for published Pages subpaths', () => {
    expect(buildPagesPathUrl({
      pagesReportUrl: 'https://jsugg.github.io/alt-text-generator/',
      publishPath: '/pr/123/',
    })).toBe('https://jsugg.github.io/alt-text-generator/pr/123');
    expect(normalizePublishPath('/pr/123/')).toBe('pr/123');
  });

  it('returns no GitHub Pages URL for non-public GitHub hosts', () => {
    expect(buildPagesReportUrl({
      repository: 'jsugg/alt-text-generator',
      serverUrl: 'https://ghe.example.com',
    })).toBeNull();
  });

  it('reads the GitHub event payload from disk', async () => {
    const eventDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-policy-event-'));
    const eventPath = path.join(eventDir, 'event.json');

    try {
      await fs.writeFile(eventPath, JSON.stringify({ number: 123 }), 'utf8');
      expect(readEventPayload(eventPath)).toEqual({ number: 123 });
    } finally {
      await fs.rm(eventDir, { force: true, recursive: true });
    }
  });

  it('rejects unsupported workflow kinds', () => {
    expect(() => parseArgs([
      '--workflow-kind',
      'unknown',
    ])).toThrow('Expected --workflow-kind to be either "ci" or "deploy"');
  });

  it('recognizes same-repository pull requests', () => {
    expect(resolvePullRequestContext({
      eventPayload: {
        pull_request: {
          number: 123,
          head: {
            repo: {
              full_name: 'jsugg/alt-text-generator',
            },
          },
        },
      },
      repository: 'jsugg/alt-text-generator',
    })).toEqual({
      isSameRepo: true,
      pullRequestNumber: '123',
    });
  });

  it('resolves the main CI history stream for pushes to main', () => {
    expect(resolveAllureHistoryPolicy({
      workflowKind: 'ci',
      env: {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
        GITHUB_SERVER_URL: 'https://github.com',
      },
    })).toEqual({
      history_artifact_name: 'allure-history-ci-main',
      history_fallback_report_url: 'https://jsugg.github.io/alt-text-generator',
      history_key: 'ci-main',
      history_retention_days: '90',
      pages_path: '',
      pages_report_url: 'https://jsugg.github.io/alt-text-generator',
      persist_history: 'true',
      publish_pages: 'true',
      report_kind: 'ci-main',
      report_label: 'CI Main',
      restore_history: 'true',
    });
  });

  it('resolves per-PR history for same-repository pull requests', () => {
    expect(resolveAllureHistoryPolicy({
      workflowKind: 'ci',
      env: {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
      },
      eventPayload: {
        pull_request: {
          number: 456,
          head: {
            repo: {
              full_name: 'jsugg/alt-text-generator',
            },
          },
        },
      },
    })).toEqual({
      history_artifact_name: 'allure-history-ci-pr-456',
      history_fallback_report_url: 'https://jsugg.github.io/alt-text-generator/pr/456',
      history_key: 'ci-pr-456',
      history_retention_days: '14',
      pages_path: 'pr/456',
      pages_report_url: 'https://jsugg.github.io/alt-text-generator/pr/456',
      persist_history: 'true',
      publish_pages: 'true',
      report_kind: 'ci-pr',
      report_label: 'CI PR #456',
      restore_history: 'true',
    });
  });

  it('disables history persistence for fork pull requests', () => {
    expect(resolveAllureHistoryPolicy({
      workflowKind: 'ci',
      env: {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
      },
      eventPayload: {
        pull_request: {
          number: 456,
          head: {
            repo: {
              full_name: 'someone-else/alt-text-generator',
            },
          },
        },
      },
    })).toEqual({
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
    });
  });

  it('does not persist branch CI history on production pushes', () => {
    expect(resolveAllureHistoryPolicy({
      workflowKind: 'ci',
      env: {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/production',
      },
    })).toEqual({
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
    });
  });

  it('persists deploy-production history on production pushes', () => {
    expect(resolveAllureHistoryPolicy({
      workflowKind: 'deploy',
      baseUrl: DEFAULT_DEPLOY_BASE_URL,
      env: {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/production',
      },
    })).toEqual({
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
    });
  });

  it('keeps manual deploy verification runs ephemeral unless explicitly persisted', () => {
    expect(resolveAllureHistoryPolicy({
      workflowKind: 'deploy',
      baseUrl: DEFAULT_DEPLOY_BASE_URL,
      persistHistory: false,
      env: {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
      },
    })).toEqual({
      history_artifact_name: '',
      history_fallback_report_url: '',
      history_key: '',
      history_retention_days: '',
      pages_path: '',
      pages_report_url: '',
      persist_history: 'false',
      publish_pages: 'false',
      report_kind: 'deploy-manual',
      report_label: 'Post Deploy Verification Manual',
      restore_history: 'false',
    });
  });

  it('allows canonical manual deploy verification runs to persist when requested', () => {
    expect(resolveAllureHistoryPolicy({
      workflowKind: 'deploy',
      baseUrl: DEFAULT_DEPLOY_BASE_URL,
      persistHistory: true,
      env: {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
      },
    })).toEqual({
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
    });
  });

  it('disables history for custom deploy verification URLs', () => {
    expect(resolveAllureHistoryPolicy({
      workflowKind: 'deploy',
      baseUrl: 'https://preview.example.com',
      persistHistory: true,
      env: {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
      },
    })).toEqual({
      history_artifact_name: '',
      history_fallback_report_url: '',
      history_key: '',
      history_retention_days: '',
      pages_path: '',
      pages_report_url: '',
      persist_history: 'false',
      publish_pages: 'false',
      report_kind: 'deploy-custom',
      report_label: 'Post Deploy Verification Custom URL',
      restore_history: 'false',
    });
  });
});
