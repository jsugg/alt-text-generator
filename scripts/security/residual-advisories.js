#!/usr/bin/env node

// Freshness model for docs/dependency-security.md.
//
// That document's central claims — which packages are pinned, which advisories
// are knowingly tolerated — were accurate and entirely ungated. The scheduled
// audit runs `npm audit --omit=dev --audit-level=high`, so it cannot see the
// advisories the document is about: they are all dev-only and all moderate.
// Nothing kept the document true; it simply was, until it would not be.
//
// Two halves, deliberately split by cost and blast radius:
//
//   --check-docs   deterministic, offline, blocking. The document's tables are
//                  generated from the manifest, so they cannot drift from it.
//   --check-audit  runs a full-tree `npm audit` and compares reality to the
//                  manifest. Scheduled and NON-BLOCKING: it depends on the
//                  advisory database, which changes without anyone touching
//                  this repo, and a required check must not fail because a
//                  third party published overnight.

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT, 'config/security/residual-advisories.json');
const DOC_PATH = path.join(ROOT, 'docs/dependency-security.md');
const LOCKFILE_PATH = path.join(ROOT, 'package-lock.json');

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
      (/** @type {any} */ entry) => `| \`${entry.package} ${entry.range}\` | ${entry.fixes} |`,
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
      const pulledBy = entry.pulledBy.map((/** @type {string} */ p) => `\`${p}\``).join(', ');

      return `- **\`${entry.package}\`** (${entry.title}, ${entry.advisory}) — pulled by ${pulledBy}. ${entry.why}`;
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
  const actual = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).overrides ?? {};
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
 * @param {string} [auditFile]
 * @returns {any}
 */
function loadAudit(auditFile) {
  if (auditFile) {
    return JSON.parse(fs.readFileSync(auditFile, 'utf8'));
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
 * @param {string} [auditFile]
 * @returns {number}
 */
function checkAudit(auditFile) {
  const manifest = readManifest();
  const audit = loadAudit(auditFile);
  const found = distinctAdvisories(audit);
  const accepted = new Set(manifest.accepted.map((/** @type {any} */ e) => e.advisory));

  const unexpected = [...found.entries()].filter(([id]) => !accepted.has(id));
  const stale = [...accepted].filter((id) => !found.has(id));
  const totals = audit.metadata?.vulnerabilities ?? {};
  const blocking = (totals.high ?? 0) + (totals.critical ?? 0);

  process.stdout.write(`security:residual full-tree audit: ${JSON.stringify(totals)}\n`);
  process.stdout.write(`  lockfile sha256: ${lockfileSha256()}\n`);
  process.stdout.write(`  manifest verified: ${manifest.verifiedAt} (${manifest.lockfileSha256})\n`);

  if (lockfileSha256() !== manifest.lockfileSha256) {
    process.stdout.write('  NOTE: lockfile has changed since the manifest was verified\n');
  }

  unexpected.forEach(([id, info]) => {
    process.stdout.write(`  UNAPPROVED ${info.severity} ${info.package} ${id} — ${info.title}\n`);
  });

  stale.forEach((id) => {
    process.stdout.write(`  RESOLVED ${id} is approved in the manifest but no longer reported — remove it\n`);
  });

  if (blocking > 0) {
    process.stdout.write(`  ${blocking} high/critical advisory(ies) present\n`);
  }

  if (unexpected.length === 0 && stale.length === 0 && blocking === 0) {
    process.stdout.write('  OK reality matches the approved manifest\n');
  }

  return unexpected.length > 0 || stale.length > 0 || blocking > 0 ? 1 : 0;
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
    const index = argv.indexOf('--audit-file');

    return checkAudit(index === -1 ? undefined : argv[index + 1]);
  }

  return checkDocs();
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  checkAudit,
  checkDocs,
  distinctAdvisories,
  lockfileSha256,
  main,
  overrideMismatches,
  renderDoc,
};
