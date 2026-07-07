#!/usr/bin/env node

// Enforces the GitHub Actions pinning policy in CI (see docs/action-pinning.md):
// third-party actions must be pinned to a full-length commit SHA; first-party
// actions/* and github/* may be referenced by tag (trusted by publisher). This
// is the enforcement layer we control — our own `uses:` — after moving off the
// runner-level `sha_pinning_required`, which also policed GitHub's own nested
// (transitive) references and broke the Pages toolchain.

const fs = require('node:fs');
const path = require('node:path');

/** Publishers trusted to be referenced by tag (GitHub's own first-party actions). */
const TRUSTED_PUBLISHERS = new Set(['actions', 'github']);

/** A full-length git commit SHA: 40 hex (SHA-1) or 64 hex (SHA-256). */
const SHA_PATTERN = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

/**
 * @typedef {{
 *   kind: 'local' | 'docker' | 'trusted' | 'pinned' | 'unpinned',
 *   owner?: string,
 *   ref?: string,
 * }} UsesClassification
 */

/**
 * Classifies a single `uses:` reference against the pinning policy.
 *
 * @param {string} reference the value after `uses:` (e.g. `owner/repo/sub@ref`)
 * @returns {UsesClassification}
 */
function classifyUses(reference) {
  const value = reference.trim().replace(/^["']|["']$/g, '');

  if (value.startsWith('./') || value.startsWith('../') || value.startsWith('.\\')) {
    return { kind: 'local' };
  }

  if (value.startsWith('docker://')) {
    return { kind: 'docker' };
  }

  const atIndex = value.lastIndexOf('@');
  const owner = value.split('/')[0] || '';

  if (atIndex === -1) {
    return { kind: 'unpinned', owner, ref: '' };
  }

  const gitRef = value.slice(atIndex + 1);

  if (TRUSTED_PUBLISHERS.has(owner)) {
    return { kind: 'trusted', owner, ref: gitRef };
  }

  if (SHA_PATTERN.test(gitRef)) {
    return { kind: 'pinned', owner, ref: gitRef };
  }

  return { kind: 'unpinned', owner, ref: gitRef };
}

/**
 * @typedef {{ file: string, line: number, ref: string }} PinViolation
 */

/**
 * Collects policy violations (unpinned third-party actions) across the files.
 *
 * @param {string[]} files
 * @returns {PinViolation[]}
 */
function collectPinViolations(files) {
  /** @type {PinViolation[]} */
  const violations = [];
  const usesPattern = /^\s*(?:-\s*)?uses:\s*(\S+)/;

  files.forEach((file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    lines.forEach((text, index) => {
      const match = usesPattern.exec(text);
      const reference = match ? match[1] : undefined;

      if (!reference) {
        return;
      }

      if (classifyUses(reference).kind === 'unpinned') {
        violations.push({ file, line: index + 1, ref: reference });
      }
    });
  });

  return violations;
}

/**
 * Lists the workflow and composite-action definition files under `.github`.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
function listWorkflowFiles(root = '.github') {
  /** @type {string[]} */
  const files = [];

  const workflowsDir = path.join(root, 'workflows');
  if (fs.existsSync(workflowsDir)) {
    fs.readdirSync(workflowsDir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .forEach((name) => files.push(path.join(workflowsDir, name)));
  }

  const actionsDir = path.join(root, 'actions');
  if (fs.existsSync(actionsDir)) {
    fs.readdirSync(actionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => {
        ['action.yml', 'action.yaml'].forEach((candidate) => {
          const candidatePath = path.join(actionsDir, entry.name, candidate);
          if (fs.existsSync(candidatePath)) {
            files.push(candidatePath);
          }
        });
      });
  }

  return files;
}

function main() {
  const files = listWorkflowFiles();
  const violations = collectPinViolations(files);

  if (violations.length > 0) {
    process.stderr.write('Unpinned third-party actions (pin to a full-length commit SHA):\n');
    violations.forEach((violation) => {
      process.stderr.write(`  ${violation.file}:${violation.line}  ${violation.ref}\n`);
    });
    process.stderr.write(
      '\nPolicy: third-party actions must pin to a commit SHA; actions/* and github/* may use a tag.\n'
      + 'See docs/action-pinning.md.\n',
    );
    process.exit(1);
  }

  process.stdout.write(`Action-pin policy OK (${files.length} files scanned).\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  classifyUses,
  collectPinViolations,
  listWorkflowFiles,
  TRUSTED_PUBLISHERS,
};
