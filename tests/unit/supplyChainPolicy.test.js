const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');

/** @param {string} relativePath */
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

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
