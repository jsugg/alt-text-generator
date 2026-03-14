const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  parseArgs,
  readEventPayload,
  resolveSourceRun,
  writeGitHubOutputs,
} = require('../../../../scripts/github/resolve-pages-source-run');

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'resolve-pages-source-run-'));
}

describe('Unit | Scripts | GitHub | Resolve Pages Source Run', () => {
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

  it('resolves workflow_run source context', () => {
    expect(resolveSourceRun({
      eventName: 'workflow_run',
      eventPayload: {
        workflow_run: {
          conclusion: 'failure',
          head_sha: 'abc123',
          id: 99,
        },
      },
    })).toEqual({
      headSha: 'abc123',
      runId: '99',
      sourceEvent: 'workflow_run',
      workflowConclusion: 'failure',
    });
  });

  it('resolves manual backfill source context', () => {
    expect(resolveSourceRun({
      dispatchRunId: '123456',
      eventName: 'workflow_dispatch',
      eventPayload: {},
    })).toEqual({
      headSha: '',
      runId: '123456',
      sourceEvent: 'workflow_dispatch',
      workflowConclusion: '',
    });
  });

  it('rejects runs without a resolvable source workflow run ID', () => {
    expect(() => resolveSourceRun({
      eventName: 'workflow_dispatch',
      eventPayload: {},
    })).toThrow('Unable to resolve the source CI workflow run ID');
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
});
