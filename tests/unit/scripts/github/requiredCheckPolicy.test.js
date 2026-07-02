const {
  collectEmittedCheckNames,
  expandJobCheckNames,
  loadPolicy,
  parsePromotionRequiredChecks,
  verifyOfflinePolicy,
  verifyPromotionAlignment,
} = require('../../../../scripts/github/verify-required-checks');

describe('Unit | Scripts | GitHub | Required Check Policy', () => {
  const policy = loadPolicy();
  const collected = collectEmittedCheckNames();

  it('accepts the committed policy against the real workflow job names', () => {
    expect(verifyOfflinePolicy(policy, collected)).toEqual([]);
  });

  it('resolves every branch-protection context from a real workflow job', () => {
    expect([...collected.checkNames.keys()]).toEqual(expect.arrayContaining([
      'actionlint',
      'codeql',
      'dependency-review',
      'docs',
      'lint',
      'newman',
      'openapi',
      'test:ci (24)',
      'test:unit (22)',
      'test:unit (24)',
    ]));
    expect(collected.failures).toEqual([]);
  });

  it('expands matrix job name templates into concrete check names', () => {
    expect(expandJobCheckNames('test-unit', {
      name: 'test:unit (${{ matrix.node-version }})',
      strategy: { matrix: { 'node-version': ['20', '22', '24'] } },
    })).toEqual({
      names: ['test:unit (20)', 'test:unit (22)', 'test:unit (24)'],
      failures: [],
    });
  });

  it('fails matrix name templates the verifier cannot resolve', () => {
    const expansion = expandJobCheckNames('mystery', {
      name: 'mystery (${{ matrix.other }})',
      strategy: { matrix: { 'node-version': ['20'] } },
    });

    expect(expansion.names).toEqual([]);
    expect(expansion.failures[0]).toContain('cannot resolve');
  });

  it('rejects policy contexts that no push/pull_request workflow publishes', () => {
    const brokenPolicy = {
      ...policy,
      mainBranchProtection: {
        ...policy.mainBranchProtection,
        contexts: [...policy.mainBranchProtection.contexts, 'typecheck'],
      },
    };

    expect(verifyOfflinePolicy(brokenPolicy, collected)).toEqual([
      expect.stringContaining('"typecheck" is not published by any push/pull_request workflow job'),
    ]);
  });

  it('rejects retired check names so stale contexts cannot come back', () => {
    const brokenPolicy = {
      ...policy,
      productionRuleset: {
        ...policy.productionRuleset,
        contexts: [...policy.productionRuleset.contexts, 'test (20)'],
      },
    };
    const failures = verifyOfflinePolicy(brokenPolicy, collected);

    expect(failures).toEqual(expect.arrayContaining([
      expect.stringContaining('matches retired pattern'),
    ]));
  });

  it('rejects duplicate contexts inside a policy list', () => {
    const brokenPolicy = {
      ...policy,
      mainBranchProtection: {
        ...policy.mainBranchProtection,
        contexts: [...policy.mainBranchProtection.contexts, 'lint'],
      },
    };

    expect(verifyOfflinePolicy(brokenPolicy, collected)).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate context "lint"'),
    ]));
  });

  it('rejects check names published by more than one workflow job', () => {
    const ambiguous = {
      checkNames: new Map([
        ['lint', ['ci.yml#lint', 'other.yml#lint']],
      ]),
      failures: [],
    };
    const minimalPolicy = {
      mainBranchProtection: { branch: 'main', contexts: ['lint'] },
      productionRuleset: { id: 1, contexts: ['lint'], bypassActors: [] },
      retiredContextPatterns: [],
    };

    expect(verifyOfflinePolicy(minimalPolicy, ambiguous)).toEqual([
      expect.stringContaining('published by multiple jobs'),
    ]);
  });

  it('keeps the production ruleset policy within the main branch policy', () => {
    const brokenPolicy = {
      ...policy,
      productionRuleset: {
        ...policy.productionRuleset,
        contexts: [...policy.productionRuleset.contexts, 'newman-full'],
      },
    };
    const failures = verifyOfflinePolicy(brokenPolicy, collected);

    expect(failures).toEqual(expect.arrayContaining([
      expect.stringContaining('is not part of the main branch policy'),
    ]));
  });

  it('keeps the promotion workflow hardcoded checks aligned with the policy', () => {
    expect(verifyPromotionAlignment(policy, parsePromotionRequiredChecks())).toEqual([]);
  });

  it('treats a promotion workflow without hardcoded checks as aligned by derivation', () => {
    expect(verifyPromotionAlignment(policy, null)).toEqual([]);
  });
});
