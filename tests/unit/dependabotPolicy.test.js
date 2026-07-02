const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const DEPENDABOT_CONFIG_PATH = path.resolve(__dirname, '..', '..', '.github', 'dependabot.yml');

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

  it('groups version updates to cut PR noise without hiding security updates', () => {
    expect(Object.keys(npmUpdate.groups)).toEqual(['npm-production', 'npm-development']);
    Object.values(npmUpdate.groups).forEach((group) => {
      expect(group['applies-to']).toBe('version-updates');
      expect(group['update-types']).toEqual(['minor', 'patch']);
    });
    expect(actionsUpdate.groups['github-actions-all']).toEqual({
      'applies-to': 'version-updates',
      patterns: ['*'],
    });
  });

  it('documents the security-update override for suppressed majors', () => {
    expect(raw).toContain('Security-update override');
    expect(raw).toContain('remove the ignore entry');
  });
});
