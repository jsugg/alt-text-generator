#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Advisory Actions storage observability (plan W15): reports cache usage and
 * artifact volume grouped by artifact name so retention tuning decisions are
 * evidence-based. Read-only; never mutates retention settings.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

/**
 * @param {string[]} argv
 * @returns {{ repo: string, summaryFile: string|null }}
 */
function parseArgs(argv) {
  const args = {
    repo: process.env.GITHUB_REPOSITORY || 'jsugg/alt-text-generator',
    summaryFile: process.env.GITHUB_STEP_SUMMARY || null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === '--repo' && value !== undefined) {
      args.repo = value;
      index += 1;
    } else if (token === '--summary-file' && value !== undefined) {
      args.summaryFile = value;
      index += 1;
    } else {
      throw new Error(`Unsupported argument: ${token}`);
    }
  }

  return args;
}

/**
 * @param {string[]} args
 * @returns {any}
 */
function runGhJson(args) {
  return JSON.parse(execFileSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim());
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const exponent = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);

  return `${(bytes / 2 ** (10 * exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Groups artifacts by name and aggregates count/size.
 *
 * @param {{ name: string, size_in_bytes: number, expired?: boolean }[]} artifacts
 * @returns {{ name: string, count: number, totalBytes: number }[]} sorted by size desc
 */
function aggregateArtifacts(artifacts) {
  const groups = new Map();

  (artifacts || []).forEach((artifact) => {
    if (artifact.expired) {
      return;
    }

    const group = groups.get(artifact.name) || { count: 0, name: artifact.name, totalBytes: 0 };

    group.count += 1;
    group.totalBytes += artifact.size_in_bytes || 0;
    groups.set(artifact.name, group);
  });

  return [...groups.values()].sort((left, right) => right.totalBytes - left.totalBytes);
}

/**
 * Renders the markdown report.
 *
 * @param {{
 *   cacheUsage: { active_caches_count: number, active_caches_size_in_bytes: number },
 *   groups: ReturnType<typeof aggregateArtifacts>,
 *   totalArtifacts: number,
 * }} options
 * @returns {string}
 */
function formatReport({ cacheUsage, groups, totalArtifacts }) {
  const lines = [
    '## Actions storage report (advisory)',
    '',
    `- Active caches: ${cacheUsage.active_caches_count} (${formatBytes(cacheUsage.active_caches_size_in_bytes)})`,
    `- Non-expired artifacts (first 100 listed): ${totalArtifacts}`,
    '',
    '| Artifact name | Count | Total size |',
    '|---|---:|---:|',
  ];

  groups.forEach((group) => {
    lines.push(`| ${group.name} | ${group.count} | ${formatBytes(group.totalBytes)} |`);
  });

  return lines.join('\n');
}

/**
 * Main entry point.
 */
function main() {
  const options = parseArgs(process.argv.slice(2));
  const cacheUsage = runGhJson(['api', `repos/${options.repo}/actions/cache/usage`]);
  const artifactsPage = runGhJson(['api', `repos/${options.repo}/actions/artifacts?per_page=100`]);
  const report = formatReport({
    cacheUsage,
    groups: aggregateArtifacts(artifactsPage.artifacts),
    totalArtifacts: artifactsPage.total_count,
  });

  console.log(report);

  if (options.summaryFile) {
    fs.appendFileSync(options.summaryFile, `${report}\n`, 'utf8');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  aggregateArtifacts,
  formatBytes,
  formatReport,
  parseArgs,
};
