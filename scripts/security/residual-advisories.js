#!/usr/bin/env node

// Freshness model for docs/dependency-security.md.
//
// That document's central claims — which transitive packages are overridden
// and whether any advisories are knowingly tolerated — must stay verifiable.
// The required production audit omits dev dependencies, so a separate
// full-tree comparison guards the development/test toolchain.
//
// Two halves, deliberately split by cost and blast radius:
//
//   --check-docs   deterministic, offline, blocking. The document's tables are
//                  generated from the manifest, so they cannot drift from it.
//                  Accepted entries render with `Expiry:`, which the docs gate
//                  fails once the date passes.
//   --check-audit  compares a full-tree `npm audit` report (`--audit-file`, as
//                  written by scripts/github/run-security-audit.sh) to the
//                  manifest. Blocking: it fails on any unapproved advisory at
//                  or above `--fail-on` (default high) and on accepted entries
//                  that are no longer reported. Lower-severity unapproved
//                  advisories are reported, not failed, so overnight
//                  low/moderate publications never break a required check.

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT, 'config/security/residual-advisories.json');
const DOC_PATH = path.join(ROOT, 'docs/dependency-security.md');
const LOCKFILE_PATH = path.join(ROOT, 'package-lock.json');

const SEVERITY_RANK = Object.freeze({
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
});
const DEFAULT_FAIL_ON = 'high';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** @param {string} name */
const START = (name) => `<!-- generated:${name} start -->`;
/** @param {string} name */
const END = (name) => `<!-- generated:${name} end -->`;

/** @returns {any} */
function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

/** @returns {string} */
function lockfileSha256() {
  return crypto.createHash('sha256').update(fs.readFileSync(LOCKFILE_PATH, 'utf8')).digest('hex');
}

/**
 * @param {any} manifest
 * @returns {string}
 */
function renderOverridesTable(manifest) {
  return [
    '| Override | Fixes |',
    '|---|---|',
    ...manifest.overrides.map(
      (/** @type {any} */ entry) => `| \`${entry.package} → ${entry.range}\` | ${entry.fixes} |`,
    ),
  ].join('\n');
}

/**
 * @param {any} manifest
 * @returns {string}
 */
function renderAcceptedList(manifest) {
  return manifest.accepted
    .map((/** @type {any} */ entry) => {
      // An unrendered or malformed date would silently escape the docs gate's
      // Expiry check, so refuse to render the entry instead.
      if (typeof entry.expires !== 'string' || !DATE_PATTERN.test(entry.expires)
        || Number.isNaN(Date.parse(entry.expires))) {
        throw new Error(`accepted advisory ${entry.advisory} needs an expires date (YYYY-MM-DD)`);
      }

      const pulledBy = entry.pulledBy.map((/** @type {string} */ p) => `\`${p}\``).join(', ');

      return `- **\`${entry.package}\`** (${entry.title}, ${entry.advisory}) — pulled by ${pulledBy}. ${entry.why} Expiry: ${entry.expires}.`;
    })
    .join('\n');
}

/**
 * @param {any} manifest
 * @returns {string}
 */
function renderVerified(manifest) {
  return [
    `Last verified against a full-tree \`npm audit\`: **${manifest.verifiedAt}**.`,
    '',
    `Lockfile at that time: \`${manifest.lockfileSha256}\``,
    '',
    'When `package-lock.json` changes, this stops matching — which is the signal',
    'to re-verify and update `config/security/residual-advisories.json`.',
  ].join('\n');
}

/**
 * @param {string} content
 * @param {string} name
 * @param {string} body
 * @returns {string}
 */
function replaceBlock(content, name, body) {
  const start = START(name);
  const end = END(name);
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);

  if (!pattern.test(content)) {
    throw new Error(`docs/dependency-security.md is missing the ${start} ... ${end} markers`);
  }

  return content.replace(pattern, `${start}\n${body}\n${end}`);
}

/**
 * @param {any} manifest
 * @returns {string}
 */
function renderDoc(manifest) {
  let content = fs.readFileSync(DOC_PATH, 'utf8');

  content = replaceBlock(content, 'overrides', renderOverridesTable(manifest));
  content = replaceBlock(content, 'accepted', renderAcceptedList(manifest));
  content = replaceBlock(content, 'verified', renderVerified(manifest));

  return content;
}

/**
 * The manifest's override list and package.json's must agree, or the document
 * describes pins the tree does not have.
 *
 * @param {any} manifest
 * @returns {string[]}
 */
function overrideMismatches(manifest) {
  const configured = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
  ).overrides ?? {};
  const actual = flattenOverrides(configured);
  const declared = Object.fromEntries(
    manifest.overrides.map((/** @type {any} */ e) => [e.package, e.range]),
  );
  /** @type {string[]} */
  const problems = [];

  Object.entries(actual).forEach(([pkg, range]) => {
    if (!(pkg in declared)) {
      problems.push(`package.json pins ${pkg} ${range} but the manifest does not list it`);
    } else if (declared[pkg] !== range) {
      problems.push(`package.json pins ${pkg} ${range} but the manifest says ${declared[pkg]}`);
    }
  });

  Object.keys(declared).forEach((pkg) => {
    if (!(pkg in actual)) {
      problems.push(`the manifest lists ${pkg} but package.json does not pin it`);
    }
  });

  return problems;
}

function checkDocs() {
  const manifest = readManifest();
  const problems = overrideMismatches(manifest);

  if (fs.readFileSync(DOC_PATH, 'utf8') !== renderDoc(manifest)) {
    problems.push(
      'docs/dependency-security.md does not match the manifest. Run: npm run security:docs -- --write',
    );
  }

  if (problems.length > 0) {
    process.stderr.write('security:docs FAILED\n');
    problems.forEach((problem) => process.stderr.write(`  - ${problem}\n`));
    return 1;
  }

  process.stdout.write(
    `security:docs OK (${manifest.overrides.length} overrides, ${manifest.accepted.length} accepted advisories, verified ${manifest.verifiedAt})\n`,
  );

  return 0;
}

function writeDocs() {
  const manifest = readManifest();

  fs.writeFileSync(DOC_PATH, renderDoc(manifest));
  process.stdout.write('security:docs wrote docs/dependency-security.md from the manifest\n');

  return 0;
}

/**
 * Rejects a report that is not a complete `npm audit --json` result, such as
 * the fallback run-security-audit.sh writes when the registry never answered.
 *
 * @param {any} audit
 * @param {string} source
 * @returns {any}
 */
function assertCompleteAudit(audit, source) {
  const counts = audit?.metadata?.vulnerabilities;
  const complete = !audit?.parseError && counts
    && ['critical', 'high', 'moderate', 'low', 'total'].every((key) => Number.isInteger(counts[key]));

  if (!complete) {
    throw new Error(`${source} is not a complete npm audit report`);
  }

  return audit;
}

/**
 * @param {string} [auditFile]
 * @returns {any}
 */
function loadAudit(auditFile) {
  if (auditFile) {
    return assertCompleteAudit(JSON.parse(fs.readFileSync(auditFile, 'utf8')), auditFile);
  }

  // npm audit exits non-zero when it finds anything, which is the normal case
  // here — the residual advisories are why this script exists.
  try {
    return JSON.parse(
      execFileSync('npm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    );
  } catch (error) {
    const stdout = /** @type {any} */ (error).stdout;

    if (typeof stdout === 'string' && stdout.trim()) {
      return JSON.parse(stdout);
    }

    throw error;
  }
}

/**
 * @param {any} audit
 * @returns {Map<string, { package: string, severity: string, title: string }>}
 */
function distinctAdvisories(audit) {
  const found = new Map();

  Object.values(audit.vulnerabilities ?? {}).forEach((/** @type {any} */ vulnerability) => {
    (vulnerability.via ?? []).forEach((/** @type {any} */ via) => {
      if (typeof via === 'string' || !via.url) {
        return;
      }

      const id = via.url.split('/').pop();

      if (!found.has(id)) {
        found.set(id, { package: via.name, severity: via.severity, title: via.title });
      }
    });
  });

  return found;
}

/**
 * Flattens npm's nested override syntax for manifest comparison.
 *
 * @param {unknown} overrides
 * @param {string} [prefix]
 * @returns {Record<string, string>}
 */
function flattenOverrides(overrides, prefix = '') {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return {};
  }

  /** @type {Record<string, string>} */
  const flattened = {};
  Object.entries(/** @type {Record<string, unknown>} */ (overrides))
    .forEach(([pkg, value]) => {
      const key = pkg === '.' && prefix ? prefix : [prefix, pkg].filter(Boolean).join('>');
      if (typeof value === 'string') {
        flattened[key] = value;
      } else {
        Object.assign(flattened, flattenOverrides(value, key));
      }
    });

  return flattened;
}

/**
 * @param {string} severity
 * @returns {number}
 */
function severityRank(severity) {
  return SEVERITY_RANK[/** @type {keyof typeof SEVERITY_RANK} */ (severity)] ?? SEVERITY_RANK.critical;
}

/**
 * Compares a full-tree audit to the manifest and applies the fail policy:
 * unapproved advisories at or above `failOn` and stale accepted entries fail;
 * unapproved advisories below it are reported only.
 *
 * @param {string} [auditFile]
 * @param {any} [manifest]
 * @param {{ failOn?: string }} [options]
 * @returns {number}
 */
function checkAudit(auditFile, manifest = readManifest(), { failOn = DEFAULT_FAIL_ON } = {}) {
  const audit = loadAudit(auditFile);
  const found = distinctAdvisories(audit);
  const accepted = new Set(manifest.accepted.map((/** @type {any} */ e) => e.advisory));
  const threshold = severityRank(failOn);

  const unexpected = [...found.entries()].filter(([id]) => !accepted.has(id));
  const blocking = unexpected.filter(([, info]) => severityRank(info.severity) >= threshold);
  const reported = unexpected.filter(([, info]) => severityRank(info.severity) < threshold);
  const stale = [...accepted].filter((id) => !found.has(id));
  const totals = audit.metadata?.vulnerabilities ?? {};

  process.stdout.write(`security:residual full-tree audit: ${JSON.stringify(totals)}\n`);
  process.stdout.write(`  fail policy: unapproved >= ${failOn}, or stale accepted entries\n`);
  process.stdout.write(`  lockfile sha256: ${lockfileSha256()}\n`);
  process.stdout.write(`  manifest verified: ${manifest.verifiedAt} (${manifest.lockfileSha256})\n`);

  if (lockfileSha256() !== manifest.lockfileSha256) {
    process.stdout.write('  NOTE: lockfile has changed since the manifest was verified\n');
  }

  blocking.forEach(([id, info]) => {
    process.stdout.write(`  BLOCKING unapproved ${info.severity} ${info.package} ${id} — ${info.title}\n`);
  });

  stale.forEach((id) => {
    process.stdout.write(`  BLOCKING stale ${id} is approved in the manifest but no longer reported — remove it\n`);
  });

  reported.forEach(([id, info]) => {
    process.stdout.write(`  REPORTED unapproved ${info.severity} ${info.package} ${id} — ${info.title}\n`);
  });

  if (blocking.length === 0 && stale.length === 0) {
    process.stdout.write(
      `  OK no unapproved advisory at or above ${failOn}; ${reported.length} lower-severity reported\n`,
    );
    return 0;
  }

  return 1;
}

/**
 * Reads `--name value` or `--name=value`.
 *
 * @param {string[]} argv
 * @param {string} name
 * @returns {string|undefined}
 */
function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = argv.indexOf(name);

  return index === -1 ? undefined : argv[index + 1];
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv = process.argv.slice(2)) {
  if (argv.includes('--write')) {
    return writeDocs();
  }

  if (argv.includes('--check-audit')) {
    const failOn = readOption(argv, '--fail-on') ?? DEFAULT_FAIL_ON;

    if (!Object.hasOwn(SEVERITY_RANK, failOn)) {
      process.stderr.write(`security:residual --fail-on must be one of ${Object.keys(SEVERITY_RANK).join(', ')}\n`);
      return 2;
    }

    try {
      return checkAudit(readOption(argv, '--audit-file'), undefined, { failOn });
    } catch (error) {
      process.stderr.write(`security:residual ${error instanceof Error ? error.message : error}\n`);
      return 2;
    }
  }

  return checkDocs();
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  assertCompleteAudit,
  checkAudit,
  checkDocs,
  distinctAdvisories,
  lockfileSha256,
  main,
  overrideMismatches,
  renderDoc,
};
