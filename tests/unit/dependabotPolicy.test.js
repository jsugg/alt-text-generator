const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEPENDABOT_CONFIG_PATH = path.join(REPO_ROOT, '.github', 'dependabot.yml');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

describe('Unit | Dependabot Policy', () => {
  const raw = fs.readFileSync(DEPENDABOT_CONFIG_PATH, 'utf8');
  const config = yaml.load(raw);
  const npmUpdate = config.updates.find((update) => update['package-ecosystem'] === 'npm');
  const actionsUpdate = config.updates.find(
    (update) => update['package-ecosystem'] === 'github-actions',
  );

  it('keeps weekly npm and github-actions update lanes', () => {
    expect(config.version).toBe(2);
    expect(config.updates).toHaveLength(2);
    expect(npmUpdate.schedule).toEqual({ interval: 'weekly' });
    expect(actionsUpdate.schedule).toEqual({ interval: 'weekly' });
  });

  it('suppresses only the known out-of-scope majors (ESLint 10, Jest 30)', () => {
    const ignored = (npmUpdate.ignore || []).map((entry) => ({
      name: entry['dependency-name'],
      types: entry['update-types'],
    }));

    expect(ignored).toEqual([
      { name: 'eslint', types: ['version-update:semver-major'] },
      { name: '@eslint/js', types: ['version-update:semver-major'] },
      { name: 'jest', types: ['version-update:semver-major'] },
    ]);
  });

  it('never suppresses minor or patch updates for the pinned packages', () => {
    (npmUpdate.ignore || []).forEach((entry) => {
      expect(entry['update-types']).toEqual(['version-update:semver-major']);
      expect(entry).not.toHaveProperty('versions');
    });
  });

  it('groups every update — all types, prod and dev — into one PR per stream', () => {
    // "Group all": one catch-all group per applies-to stream. No update-types
    // filter, so majors are included; no dependency-type filter, so production
    // and development dependencies land in the same PR.
    /**
     * @param {unknown} group
     * @param {string} appliesTo
     */
    const assertCatchAll = (group, appliesTo) => {
      expect(group).toEqual({ 'applies-to': appliesTo, patterns: ['*'] });
    };

    expect(Object.keys(npmUpdate.groups)).toEqual(['npm-all', 'npm-security']);
    assertCatchAll(npmUpdate.groups['npm-all'], 'version-updates');
    assertCatchAll(npmUpdate.groups['npm-security'], 'security-updates');

    expect(Object.keys(actionsUpdate.groups)).toEqual([
      'github-actions-all',
      'github-actions-security',
    ]);
    assertCatchAll(actionsUpdate.groups['github-actions-all'], 'version-updates');
    assertCatchAll(actionsUpdate.groups['github-actions-security'], 'security-updates');
  });

  it('does not auto-merge dependabot PRs (manual-review posture)', () => {
    const dependabotSignal = /dependabot/i;
    const mergeAction = /(gh pr merge|pull-request-merge|auto-?merge|merge-action)/i;

    /** @type {string[]} */
    const offenders = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .filter((name) => {
        const body = fs.readFileSync(path.join(WORKFLOWS_DIR, name), 'utf8');
        return dependabotSignal.test(body) && mergeAction.test(body);
      });

    expect(offenders).toEqual([]);
  });

  it('documents the group-all, manual-merge posture and the security-update override', () => {
    expect(raw).toContain('GROUP ALL');
    expect(raw).toContain('no auto-merge');
    expect(raw).toContain('Security-update override');
    expect(raw).toContain('remove the ignore entry');
  });
});
