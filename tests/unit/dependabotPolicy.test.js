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

  it('does not suppress dependency updates', () => {
    expect(npmUpdate).not.toHaveProperty('ignore');
  });

  it('isolates majors while grouping routine updates by production reachability', () => {
    /**
     * @param {unknown} group
     * @param {unknown} expected
     */
    const assertGroup = (group, expected) => {
      expect(group).toEqual(expected);
    };

    expect(Object.keys(npmUpdate.groups)).toEqual([
      'pino-major',
      'npm-production-minor-patch',
      'npm-development-minor-patch',
      'npm-security',
    ]);
    assertGroup(npmUpdate.groups['pino-major'], {
      'applies-to': 'version-updates',
      patterns: ['pino', 'pino-http'],
      'update-types': ['major'],
    });
    assertGroup(npmUpdate.groups['npm-production-minor-patch'], {
      'applies-to': 'version-updates',
      'dependency-type': 'production',
      patterns: ['*'],
      'update-types': ['minor', 'patch'],
    });
    assertGroup(npmUpdate.groups['npm-development-minor-patch'], {
      'applies-to': 'version-updates',
      'dependency-type': 'development',
      patterns: ['*'],
      'update-types': ['minor', 'patch'],
    });
    assertGroup(npmUpdate.groups['npm-security'], {
      'applies-to': 'security-updates',
      patterns: ['*'],
    });

    expect(Object.keys(actionsUpdate.groups)).toEqual([
      'github-actions-all',
      'github-actions-security',
    ]);
    assertGroup(actionsUpdate.groups['github-actions-all'], {
      'applies-to': 'version-updates',
      patterns: ['*'],
    });
    assertGroup(actionsUpdate.groups['github-actions-security'], {
      'applies-to': 'security-updates',
      patterns: ['*'],
    });
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

  it('documents the targeted-group, manual-merge posture and visible security updates', () => {
    expect(raw).toContain('TARGETED GROUPS');
    expect(raw).toContain('no auto-merge');
    expect(raw).toContain('No update ignores');
    expect(raw).toContain('security fixes must remain visible');
  });
});
