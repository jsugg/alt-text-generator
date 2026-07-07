const {
  classifyUses,
  collectPinViolations,
  listWorkflowFiles,
} = require('../../../../scripts/github/verify-action-pins');

describe('Unit | GitHub Action Pin Policy', () => {
  it('requires third-party actions to be pinned to a commit SHA', () => {
    expect(classifyUses(
      'EnricoMi/publish-unit-test-result-action@d0a4676d0e0b938bc201470d88276b7c74c712b3',
    ).kind).toBe('pinned');
    expect(classifyUses('some-org/some-action@v1').kind).toBe('unpinned');
    expect(classifyUses('some-org/some-action@main').kind).toBe('unpinned');
    expect(classifyUses('some-org/some-action').kind).toBe('unpinned');
  });

  it('trusts actions/* and github/* by publisher (tag or SHA allowed)', () => {
    expect(classifyUses('actions/checkout@v4').kind).toBe('trusted');
    expect(classifyUses('github/codeql-action/init@v3').kind).toBe('trusted');
    expect(classifyUses(
      'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
    ).kind).toBe('trusted');
  });

  it('ignores local and docker references', () => {
    expect(classifyUses('./.github/actions/setup-node-project').kind).toBe('local');
    expect(classifyUses('docker://alpine:3.20').kind).toBe('docker');
  });

  it('flags an unpinned third-party action with its file and line', () => {
    const os = require('node:os');
    const fs = require('node:fs');
    const path = require('node:path');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-policy-'));
    const workflowsDir = path.join(dir, 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
    const file = path.join(workflowsDir, 'sample.yml');
    fs.writeFileSync(
      file,
      ['jobs:', '  build:', '    steps:', '      - uses: evil/action@v1'].join('\n'),
      'utf8',
    );

    try {
      const violations = collectPinViolations(listWorkflowFiles(dir));
      expect(violations).toEqual([{ file, line: 4, ref: 'evil/action@v1' }]);
    } finally {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it('every action referenced in .github satisfies the pinning policy', () => {
    const files = listWorkflowFiles();

    expect(files.length).toBeGreaterThan(0);
    expect(collectPinViolations(files)).toEqual([]);
  });
});
