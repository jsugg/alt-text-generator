#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

// Runtime configuration modules. Deliberately config/*.js rather than config/**:
// the latter would sweep in config/jest/*.cjs, whose ALLURE_RESULTS_DIR is a
// reporter switch rather than application configuration and has no business in
// .env.example.
const CONFIG_PATHSPEC = 'config/*.js';

// Internal working notes. These are never a legitimate reference from published
// documentation, whatever they are named or wherever they are kept.
const PROHIBITED_REFERENCES = [
  { label: '.local/', pattern: /\.local\// },
  { label: 'docs/typecheck-debt.md', pattern: /docs\/typecheck-debt\.md/ },
  { label: 'jobs.md', pattern: /(?:^|[\s(['"/])jobs\.md/ },
];

/**
 * @typedef {{ file: string, line: number, message: string }} DocViolation
 */

/**
 * @param {string} rootDir
 * @param {string} [pathspec]
 * @returns {string[]}
 */
function gitLsFiles(rootDir, pathspec) {
  const args = ['-C', rootDir, 'ls-files', '-z'];

  if (pathspec) {
    args.push('--', pathspec);
  }

  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

/**
 * Enumerates the Markdown files git tracks under `rootDir`.
 *
 * This deliberately asks git rather than walking the filesystem. A walk with a
 * hardcoded skip list saw whatever happened to be on the developer's disk, so
 * the gate's verdict depended on untracked local state: it validated scratch
 * notes under `.local/`, and a note saved with CRLF failed the gate locally
 * while CI — which only ever has the tracked files — passed. Asking git makes
 * the local result and the clean-checkout result the same set by construction.
 *
 * @param {string} [rootDir]
 * @returns {string[]}
 */
function listMarkdownFiles(rootDir = ROOT) {
  return gitLsFiles(rootDir, '*.md')
    .map((relativePath) => path.join(rootDir, relativePath))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Blanks out fenced blocks and inline code spans so illustrative snippets are
 * not mistaken for real images, links, or references. Newlines survive, so
 * reported line numbers still point at the right source line.
 *
 * @param {string} content
 * @returns {string}
 */
function stripCode(content) {
  return content
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (span) => span.replace(/[^\n]/g, ' '));
}

/**
 * GitHub's heading-anchor slug: lowercase, drop everything that is not a word
 * character, space, or hyphen, then hyphenate the spaces.
 *
 * @param {string} heading
 * @returns {string}
 */
function slugifyHeading(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/**
 * Repeated headings get `-1`, `-2`, ... exactly as GitHub disambiguates them.
 *
 * @param {string} content
 * @returns {Set<string>}
 */
function collectAnchors(content) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {Set<string>} */
  const anchors = new Set();

  stripCode(content).split('\n').forEach((line) => {
    const match = /^#{1,6}\s+(.*?)\s*$/.exec(line);

    if (!match) {
      return;
    }

    const base = slugifyHeading(match[1]);

    if (!base) {
      return;
    }

    const count = seen.get(base) ?? 0;

    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  });

  return anchors;
}

/**
 * Raw `<img>` tags must carry an `alt` attribute. The value may be empty —
 * `alt=""` is the honest way to say "decorative" — but it has to be a decision
 * someone made rather than an omission. Markdown's `![alt](src)` always carries
 * the slot, so only the HTML form can be missing it; both syntaxes appear in
 * Markdown files, which is why both are scanned.
 *
 * @param {string} content
 * @param {string} relativePath
 * @returns {DocViolation[]}
 */
function checkImageAlt(content, relativePath) {
  /** @type {DocViolation[]} */
  const violations = [];

  stripCode(content).split('\n').forEach((line, index) => {
    (line.match(/<img\b[^>]*>/gi) ?? []).forEach((tag) => {
      if (!/\salt\s*=/i.test(tag)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          message: 'Image must have an alt attribute (use alt="" if decorative)',
        });
      }
    });
  });

  return violations;
}

/**
 * @param {string} content
 * @param {string} relativePath
 * @returns {DocViolation[]}
 */
function checkProhibitedReferences(content, relativePath) {
  /** @type {DocViolation[]} */
  const violations = [];

  stripCode(content).split('\n').forEach((line, index) => {
    PROHIBITED_REFERENCES.forEach(({ label, pattern }) => {
      if (pattern.test(line)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          message: `Documentation must not reference internal working notes (${label})`,
        });
      }
    });
  });

  return violations;
}

/**
 * @param {string} content
 * @returns {Array<{ target: string, line: number }>}
 */
function collectLinkTargets(content) {
  /** @type {Array<{ target: string, line: number }>} */
  const links = [];

  stripCode(content).split('\n').forEach((line, index) => {
    const inline = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let match = inline.exec(line);

    while (match !== null) {
      links.push({ target: match[1], line: index + 1 });
      match = inline.exec(line);
    }
  });

  return links;
}

/**
 * Internal links must resolve: the target has to be tracked by git, and any
 * fragment has to match a heading in it.
 *
 * Only link *targets* are held to that standard. Prose stays free to name a
 * gitignored path — `certs/localhost-key.pem` is documented precisely because it
 * is not checked in — so this never inspects prose.
 *
 * @param {string[]} files
 * @param {string} rootDir
 * @returns {DocViolation[]}
 */
function checkInternalLinks(files, rootDir) {
  const tracked = new Set(gitLsFiles(rootDir));
  /** @type {Map<string, Set<string>>} */
  const anchorCache = new Map();

  /** @param {string} absolutePath */
  const anchorsFor = (absolutePath) => {
    if (!anchorCache.has(absolutePath)) {
      anchorCache.set(absolutePath, collectAnchors(fs.readFileSync(absolutePath, 'utf8')));
    }

    return /** @type {Set<string>} */ (anchorCache.get(absolutePath));
  };

  return files.flatMap((filePath) => {
    const relativePath = path.relative(rootDir, filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    return collectLinkTargets(content).flatMap(({ target, line }) => {
      // Anything with a scheme (http:, mailto:) or protocol-relative is external.
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) {
        return [];
      }

      const hashIndex = target.indexOf('#');
      const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
      const fragment = hashIndex === -1 ? '' : decodeURIComponent(target.slice(hashIndex + 1));

      if (!rawPath) {
        if (anchorsFor(filePath).has(fragment)) {
          return [];
        }

        return [{
          file: relativePath,
          line,
          message: `Link points at a heading that does not exist: #${fragment}`,
        }];
      }

      const resolved = path.normalize(
        path.join(path.dirname(relativePath), decodeURIComponent(rawPath)),
      );

      if (!tracked.has(resolved)) {
        return [{
          file: relativePath,
          line,
          message: `Link points at a path git does not track: ${rawPath}`,
        }];
      }

      if (!fragment || !resolved.toLowerCase().endsWith('.md')) {
        return [];
      }

      if (anchorsFor(path.join(rootDir, resolved)).has(fragment)) {
        return [];
      }

      return [{
        file: relativePath,
        line,
        message: `Link points at a heading that does not exist in ${rawPath}: #${fragment}`,
      }];
    });
  });
}

/**
 * Every environment variable the runtime configuration reads must be documented
 * in DEVELOPMENT.md — which calls itself the full configuration reference — and
 * in .env.example. This is the check that catches a setting becoming a
 * production affordance nobody wrote down.
 *
 * @param {string} rootDir
 * @returns {DocViolation[]}
 */
function checkEnvVarCoverage(rootDir) {
  const configFiles = gitLsFiles(rootDir, CONFIG_PATHSPEC);

  if (configFiles.length === 0) {
    return [];
  }

  /** @type {Map<string, string>} */
  const readBy = new Map();

  configFiles.forEach((relativePath) => {
    const content = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
    const pattern = /process\.env\.([A-Z0-9_]+)/g;
    let match = pattern.exec(content);

    while (match !== null) {
      if (!readBy.has(match[1])) {
        readBy.set(match[1], relativePath);
      }

      match = pattern.exec(content);
    }
  });

  const surfaces = [
    { file: 'DEVELOPMENT.md', label: 'the configuration reference' },
    { file: '.env.example', label: 'the environment template' },
  ];

  return surfaces.flatMap(({ file, label }) => {
    const absolutePath = path.join(rootDir, file);

    if (!fs.existsSync(absolutePath)) {
      return [];
    }

    const content = fs.readFileSync(absolutePath, 'utf8');

    return [...readBy.entries()]
      .filter(([name]) => !new RegExp(`\\b${name}\\b`).test(content))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, source]) => ({
        file,
        line: 1,
        message: `${name} is read by ${source} but is undocumented in ${label}`,
      }));
  });
}

/**
 * @param {string} filePath
 * @param {string} [rootDir]
 * @returns {DocViolation[]}
 */
function validateMarkdownFile(filePath, rootDir = ROOT) {
  const relativePath = path.relative(rootDir, filePath) || filePath;
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  if (content.trim().length === 0) {
    violations.push({
      file: relativePath,
      line: 1,
      message: 'Markdown file must not be empty',
    });
  }

  if (content.includes('\r')) {
    violations.push({
      file: relativePath,
      line: 1,
      message: 'Markdown file must use LF line endings',
    });
  }

  content.split('\n').forEach((line, index) => {
    if (/^(<<<<<<<|=======|>>>>>>>)/u.test(line)) {
      violations.push({
        file: relativePath,
        line: index + 1,
        message: 'Markdown file contains a merge-conflict marker',
      });
    }
  });

  violations.push(...checkImageAlt(content, relativePath));
  violations.push(...checkProhibitedReferences(content, relativePath));

  return violations;
}

function validateDocs({ rootDir = ROOT } = {}) {
  const files = listMarkdownFiles(rootDir);

  return {
    files: files.map((filePath) => path.relative(rootDir, filePath) || filePath),
    violations: [
      ...files.flatMap((filePath) => validateMarkdownFile(filePath, rootDir)),
      ...checkInternalLinks(files, rootDir),
      ...checkEnvVarCoverage(rootDir),
    ],
  };
}

/** @param {{ files: string[], violations: DocViolation[] }} report */
function writeReport({ files, violations }) {
  if (violations.length === 0) {
    process.stdout.write(`docs:validate OK (${files.length} Markdown files)\n`);
    return;
  }

  process.stderr.write(`docs:validate FAILED: ${violations.length} violation(s)\n`);
  violations.forEach((violation) => {
    process.stderr.write(`  - ${violation.file}:${violation.line} ${violation.message}\n`);
  });
}

/**
 * @param {string[]} argv
 * @returns {{ json: boolean, rootDir: string }}
 */
function parseArgs(argv) {
  const args = { json: false, rootDir: ROOT };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--root') {
      index += 1;

      if (typeof argv[index] !== 'string') {
        throw new Error('--root requires a directory argument');
      }

      args.rootDir = path.resolve(argv[index]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function main(argv = process.argv.slice(2)) {
  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`docs:validate ${error instanceof Error ? error.message : error}\n`);
    return 2;
  }

  const result = validateDocs({ rootDir: args.rootDir });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    writeReport(result);
  }

  return result.violations.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  checkEnvVarCoverage,
  checkImageAlt,
  checkInternalLinks,
  checkProhibitedReferences,
  collectAnchors,
  listMarkdownFiles,
  main,
  parseArgs,
  slugifyHeading,
  validateDocs,
  validateMarkdownFile,
};
