const {
  buildApiUrl,
  dispatchPagesPublish,
  parseArgs,
  postGitHubJson,
} = require('../../../../scripts/github/dispatch-pages-publish');

describe('Unit | Scripts | GitHub | Dispatch Pages Publish', () => {
  it('parses CLI arguments with defaults', () => {
    expect(parseArgs([
      '--repo',
      'jsugg/alt-text-generator',
      '--run-id',
      '12345',
    ])).toEqual({
      apiBaseUrl: 'https://api.github.com/',
      ref: 'main',
      repo: 'jsugg/alt-text-generator',
      runId: '12345',
      workflow: 'allure-pages-publish.yml',
    });
  });

  it('rejects invalid CLI arguments', () => {
    expect(() => parseArgs([
      '--repo',
      'jsugg/alt-text-generator',
    ])).toThrow('--repo and --run-id are required');
    expect(() => parseArgs([
      '--repo',
      'jsugg/alt-text-generator',
      '--run-id',
      '12345',
      '--unsupported',
      'value',
    ])).toThrow('Unsupported argument: --unsupported');
  });

  it('builds API URLs relative to the configured GitHub API base', () => {
    expect(buildApiUrl('https://api.github.com', '/repos/jsugg/alt-text-generator')).toBe(
      'https://api.github.com/repos/jsugg/alt-text-generator',
    );
  });

  it('posts GitHub workflow dispatch requests', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });

    await postGitHubJson({
      body: { ref: 'main' },
      fetchImpl,
      token: 'test-token',
      url: 'https://api.github.com/repos/jsugg/alt-text-generator/actions/workflows/allure-pages-publish.yml/dispatches',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/jsugg/alt-text-generator/actions/workflows/allure-pages-publish.yml/dispatches',
      expect.objectContaining({
        body: JSON.stringify({ ref: 'main' }),
        method: 'POST',
      }),
    );
  });

  it('fails dispatch when the token is missing', async () => {
    await expect(dispatchPagesPublish({
      apiBaseUrl: 'https://api.github.com/',
      ref: 'main',
      repo: 'jsugg/alt-text-generator',
      runId: '12345',
      token: '',
      workflow: 'allure-pages-publish.yml',
    })).rejects.toThrow('Missing required environment variable: GITHUB_TOKEN');
  });

  it('dispatches the publish workflow for the source CI run', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });

    await dispatchPagesPublish({
      apiBaseUrl: 'https://api.github.com/',
      fetchImpl,
      ref: 'main',
      repo: 'jsugg/alt-text-generator',
      runId: '23088523772',
      token: 'test-token',
      workflow: 'allure-pages-publish.yml',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/jsugg/alt-text-generator/actions/workflows/allure-pages-publish.yml/dispatches',
      expect.objectContaining({
        body: JSON.stringify({
          inputs: {
            run_id: '23088523772',
          },
          ref: 'main',
        }),
        method: 'POST',
      }),
    );
  });
});
