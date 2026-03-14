const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildApiUrl,
  fetchWorkflowRun,
  main,
  parseArgs,
  readEventPayload,
  resolveSourceRun,
  writeGitHubOutputs,
} = require('../../../../scripts/github/resolve-pages-source-run');

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'resolve-pages-source-run-'));
}

describe('Unit | Scripts | GitHub | Resolve Pages Source Run', () => {
  afterEach(() => {
    delete process.env.GITHUB_API_URL;
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;
  });

  it('parses CLI arguments', () => {
    expect(parseArgs([
      '--github-output',
      'reports/pages/github-output.txt',
    ])).toEqual({
      githubOutput: 'reports/pages/github-output.txt',
    });
  });

  it('rejects invalid CLI arguments', () => {
    expect(() => parseArgs([])).toThrow('Missing required argument: --github-output <path>');
    expect(() => parseArgs([
      '--github-output',
      'reports/pages/github-output.txt',
      '--unsupported',
      'value',
    ])).toThrow('Unknown argument: --unsupported');
  });

  it('reads the GitHub event payload from disk', async () => {
    const tempDir = await createTempDir();
    const eventPath = path.join(tempDir, 'event.json');

    await fs.writeFile(eventPath, JSON.stringify({ workflow_run: { id: 42 } }), 'utf8');

    expect(readEventPayload(eventPath)).toEqual({
      workflow_run: { id: 42 },
    });
  });

  it('resolves workflow_run source context', async () => {
    await expect(resolveSourceRun({
      eventName: 'workflow_run',
      eventPayload: {
        workflow_run: {
          conclusion: 'failure',
          event: 'push',
          head_sha: 'abc123',
          id: 99,
        },
      },
    })).resolves.toEqual({
      headSha: 'abc123',
      runId: '99',
      sourceEvent: 'push',
      workflowConclusion: 'failure',
    });
  });

  it('falls back to the workflow event name when the source workflow event is absent', async () => {
    await expect(resolveSourceRun({
      eventName: 'workflow_run',
      eventPayload: {
        workflow_run: {
          conclusion: 'failure',
          head_sha: 'abc123',
          id: 99,
        },
      },
    })).resolves.toEqual({
      headSha: 'abc123',
      runId: '99',
      sourceEvent: 'workflow_run',
      workflowConclusion: 'failure',
    });
  });

  it('builds API URLs relative to the configured GitHub API base', () => {
    expect(buildApiUrl('https://api.github.com', '/repos/jsugg/alt-text-generator/actions/runs/99')).toBe(
      'https://api.github.com/repos/jsugg/alt-text-generator/actions/runs/99',
    );
  });

  it('looks up workflow_dispatch source context from the GitHub API', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        conclusion: 'success',
        event: 'pull_request',
        head_sha: 'def456',
        id: 123456,
      }),
    });

    await expect(resolveSourceRun({
      apiBaseUrl: 'https://api.github.com/',
      dispatchRunId: '123456',
      eventName: 'workflow_dispatch',
      eventPayload: {},
      fetchImpl,
      repository: 'jsugg/alt-text-generator',
      token: 'test-token',
    })).resolves.toEqual({
      headSha: 'def456',
      runId: '123456',
      sourceEvent: 'pull_request',
      workflowConclusion: 'success',
    });
  });

  it('fetches workflow run details from the GitHub API', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        conclusion: 'success',
        event: 'pull_request',
        head_sha: 'def456',
        id: 123456,
      }),
    });

    await expect(fetchWorkflowRun({
      apiBaseUrl: 'https://api.github.com/',
      fetchImpl,
      repository: 'jsugg/alt-text-generator',
      runId: '123456',
      token: 'test-token',
    })).resolves.toEqual({
      conclusion: 'success',
      event: 'pull_request',
      head_sha: 'def456',
      id: 123456,
    });
  });

  it('surfaces GitHub workflow lookup failures', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'missing',
    });

    await expect(fetchWorkflowRun({
      apiBaseUrl: 'https://api.github.com/',
      fetchImpl,
      repository: 'jsugg/alt-text-generator',
      runId: '123456',
      token: 'test-token',
    })).rejects.toThrow('GitHub workflow run lookup failed with status 404: missing');
  });

  it('rejects workflow_dispatch runs without a resolvable source workflow run ID', async () => {
    await expect(resolveSourceRun({
      eventName: 'workflow_dispatch',
      eventPayload: {},
    })).rejects.toThrow('Unable to resolve the source CI workflow run ID');
  });

  it('rejects workflow run lookup without GitHub context', async () => {
    await expect(fetchWorkflowRun({
      repository: '',
      runId: '123456',
      token: 'test-token',
    })).rejects.toThrow('Missing required environment variable: GITHUB_REPOSITORY');

    await expect(fetchWorkflowRun({
      repository: 'jsugg/alt-text-generator',
      runId: '123456',
      token: '',
    })).rejects.toThrow('Missing required environment variable: GITHUB_TOKEN');
  });

  it('writes source-run fields to GitHub outputs', async () => {
    const tempDir = await createTempDir();
    const githubOutput = path.join(tempDir, 'github-output.txt');

    writeGitHubOutputs({
      githubOutput,
      sourceRun: {
        headSha: 'abc123',
        runId: '99',
        sourceEvent: 'workflow_run',
        workflowConclusion: 'failure',
      },
    });

    await expect(fs.readFile(githubOutput, 'utf8')).resolves.toBe(
      'run_id=99\nsource_event=workflow_run\nworkflow_conclusion=failure\nhead_sha=abc123\n',
    );
  });

  it('writes workflow_dispatch source-run outputs through the CLI', async () => {
    const tempDir = await createTempDir();
    const eventPath = path.join(tempDir, 'event.json');
    const githubOutput = path.join(tempDir, 'github-output.txt');
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        conclusion: 'success',
        event: 'pull_request',
        head_sha: 'def456',
        id: 123456,
      }),
    });

    await fs.writeFile(eventPath, JSON.stringify({}), 'utf8');

    await main({
      argv: [
        '--github-output',
        githubOutput,
      ],
      env: {
        DISPATCH_RUN_ID: '123456',
        GITHUB_API_URL: 'https://api.github.com/',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
        GITHUB_TOKEN: 'test-token',
      },
      fetchImpl,
    });

    await expect(fs.readFile(githubOutput, 'utf8')).resolves.toBe(
      'run_id=123456\nsource_event=pull_request\nworkflow_conclusion=success\nhead_sha=def456\n',
    );
  });
});
