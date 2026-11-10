const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');

/** @param {string} relativePath */
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

/**
 * Loads `dependency` the way `consumer` resolves it. npm may hoist a different
 * major of the same package to the root, so a bare require would probe the
 * wrong copy.
 *
 * @param {string} consumer
 * @param {string} dependency
 * @returns {any}
 */
const requireAsSeenBy = (consumer, dependency) => {
  const resolved = require.resolve(dependency, { paths: [path.dirname(require.resolve(consumer))] });

  // eslint-disable-next-line import-x/no-dynamic-require
  return require(resolved);
};

/**
 * Collects files under `dir` whose name matches `pattern`, recursively.
 *
 * @param {string} dir
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function collectFiles(dir, pattern) {
  /** @type {string[]} */
  const found = [];

  if (!fs.existsSync(dir)) {
    return found;
  }

  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectFiles(full, pattern));
    } else if (pattern.test(entry.name)) {
      found.push(full);
    }
  });

  return found;
}

describe('Unit | Supply-chain pinning posture', () => {
  it('marks the package private so the service is never accidentally published', () => {
    const pkg = JSON.parse(read('package.json'));

    expect(pkg.private).toBe(true);
  });

  it('commits a lockfile and installs it frozen (npm ci) in CI', () => {
    expect(fs.existsSync(path.join(repoRoot, 'package-lock.json'))).toBe(true);

    const setup = read(path.join('.github', 'actions', 'setup-node-project', 'action.yml'));
    expect(setup).toMatch(/\bnpm ci\b/);
  });

  it('keeps Newman security overrides compatible with their CommonJS consumers', () => {
    const jose = requireAsSeenBy('postman-runtime', 'jose');
    const SerialisedError = require('serialised-error');
    const uuid = requireAsSeenBy('serialised-error', 'uuid');

    const decorated = SerialisedError(new Error('compatibility probe'), true);

    expect(typeof jose.SignJWT).toBe('function');
    expect(typeof jose.importPKCS8).toBe('function');
    expect(uuid.v4()).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(decorated.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  });

  it('resolves Newman faker to the fail-closed local stub, not a registry package', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    const stubDir = path.join(repoRoot, 'tools', 'faker-stub');
    const resolved = require.resolve('@faker-js/faker/locale/en', {
      paths: [path.dirname(require.resolve('postman-collection'))],
    });

    expect(pkg.devDependencies['@faker-js/faker']).toBe('file:tools/faker-stub');
    expect(pkg.overrides.newman['postman-collection']).toEqual({
      '@faker-js/faker': '$@faker-js/faker',
    });
    expect(fs.realpathSync(resolved)).toBe(path.join(fs.realpathSync(stubDir), 'locale', 'en.js'));

    const fakerEntries = Object.entries(lock.packages)
      .filter(([key, entry]) => key.endsWith('@faker-js/faker') || entry.name === '@faker-js/faker');

    expect(Object.fromEntries(fakerEntries)).toEqual({
      'node_modules/@faker-js/faker': { resolved: 'tools/faker-stub', link: true },
      'tools/faker-stub': expect.objectContaining({
        name: '@faker-js/faker', version: '0.0.0-security-stub',
      }),
    });
    fakerEntries.forEach(([, entry]) => {
      expect(entry.integrity).toBeUndefined();
      expect(String(entry.resolved ?? '')).not.toMatch(/^https?:/u);
    });
  });

  it('never pipes a network download straight into a shell', () => {
    const files = [
      ...collectFiles(path.join(repoRoot, '.github'), /\.(sh|ya?ml|bash)$/),
      ...collectFiles(path.join(repoRoot, 'scripts'), /\.(sh|ya?ml|bash)$/),
    ];
    const pipeToShell = /\b(curl|wget)\b[^\n|]*\|[^\n]*\b(bash|sh)\b/;

    /** @type {string[]} */
    const offenders = files.filter((file) => pipeToShell.test(fs.readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });
});
