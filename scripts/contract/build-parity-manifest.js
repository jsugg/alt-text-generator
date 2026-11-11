#!/usr/bin/env node

/**
 * Generates (or verifies) the checked-in Newman-to-Jest parity manifest.
 *
 * The manifest lists every collection request, `pm.test` block, and matcher
 * site with a stable id, plus the Jest test each block is ported to (`jestTest`,
 * null until ported). Regeneration keeps a `jestTest` mapping only while the
 * block keeps both its id and its name, and refuses to drop a mapping silently:
 * writing fails on orphaned mappings unless `--prune` is passed. `--check` fails
 * when the committed manifest no longer matches the collection.
 *
 * Usage:
 *   node scripts/contract/build-parity-manifest.js [--prune]  # write manifest
 *   node scripts/contract/build-parity-manifest.js --check    # verify freshness
 */

const fs = require('node:fs');
const path = require('node:path');

const { readCollection } = require('../postman/collection-utils');
const { buildCollectionInventory } = require('./collection-inventory');

/** @typedef {import('./collection-inventory').PmTestBlock} PmTestBlock */
/** @typedef {import('./collection-inventory').MatcherSite} MatcherSite */
/** @typedef {import('./collection-inventory').RequestInventory} RequestInventory */

/**
 * @typedef {PmTestBlock & { jestTest: string | null }} ManifestPmTest
 */

/**
 * @typedef {object} ParityManifest
 * @property {number} schemaVersion
 * @property {string} source
 * @property {import('./collection-inventory').InventoryTotals & { portedPmTests: number }} totals
 * @property {{ pmTests: ManifestPmTest[], unownedMatchers: MatcherSite[] }} collectionScript
 * @property {{
 *   name: string,
 *   pmTests: ManifestPmTest[],
 *   unownedMatchers: MatcherSite[],
 *   requests: (Omit<RequestInventory, 'pmTests'> & { pmTests: ManifestPmTest[] })[],
 * }[]} folders
 */

/** @typedef {{ id: string, name: string, jestTest: string }} JestMapping */

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_VERSION = 1;
const DEFAULT_COLLECTION_PATH = path.join(
  ROOT,
  'postman',
  'collections',
  'alt-text-generator.postman_collection.json',
);
const DEFAULT_MANIFEST_PATH = path.join(ROOT, 'tests', 'contract', 'parity-manifest.json');

/**
 * @param {Partial<ParityManifest> | null} manifest
 * @returns {Partial<ManifestPmTest>[]}
 */
function listManifestPmTests(manifest) {
  if (!manifest) {
    return [];
  }

  return [
    ...(manifest.collectionScript?.pmTests ?? []),
    ...(manifest.folders ?? []).flatMap((folder) => [
      ...(folder.pmTests ?? []),
      ...(folder.requests ?? []).flatMap((request) => request.pmTests ?? []),
    ]),
  ];
}

/**
 * @param {Partial<ParityManifest> | null} manifest
 * @returns {Map<string, JestMapping>}
 */
function collectJestMappings(manifest) {
  /** @type {Map<string, JestMapping>} */
  const mappings = new Map();

  listManifestPmTests(manifest).forEach((pmTest) => {
    if (typeof pmTest.id === 'string' && typeof pmTest.jestTest === 'string' && pmTest.jestTest !== '') {
      mappings.set(pmTest.id, { id: pmTest.id, name: String(pmTest.name ?? ''), jestTest: pmTest.jestTest });
    }
  });

  return mappings;
}

/**
 * Attaches a mapping only when the block kept its id and its name: a `~n`
 * suffix that shifted onto a different block must not inherit a port.
 *
 * @param {PmTestBlock[]} pmTests
 * @param {Map<string, JestMapping>} mappings
 * @returns {ManifestPmTest[]}
 */
function attachMappings(pmTests, mappings) {
  return pmTests.map((pmTest) => {
    const mapping = mappings.get(pmTest.id);

    return { ...pmTest, jestTest: mapping && mapping.name === pmTest.name ? mapping.jestTest : null };
  });
}

/**
 * Builds the manifest for a collection, carrying over `jestTest` mappings from
 * a previous manifest.
 *
 * @param {{
 *   collection: import('../postman/collection-utils').PostmanCollection,
 *   previousManifest?: Partial<ParityManifest> | null,
 *   source?: string,
 * }} options
 * @returns {ParityManifest}
 */
function buildParityManifest({
  collection,
  previousManifest = null,
  source = path.relative(ROOT, DEFAULT_COLLECTION_PATH),
}) {
  const inventory = buildCollectionInventory(collection);
  const mappings = collectJestMappings(previousManifest);
  const folders = inventory.folders.map((folder) => ({
    name: folder.name,
    pmTests: attachMappings(folder.pmTests, mappings),
    unownedMatchers: folder.unownedMatchers,
    requests: folder.requests.map((request) => ({
      ...request,
      pmTests: attachMappings(request.pmTests, mappings),
    })),
  }));
  /** @type {ParityManifest} */
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    source: source.split(path.sep).join('/'),
    totals: { ...inventory.totals, portedPmTests: 0 },
    collectionScript: {
      pmTests: attachMappings(inventory.collectionScript.pmTests, mappings),
      unownedMatchers: inventory.collectionScript.unownedMatchers,
    },
    folders,
  };

  manifest.totals.portedPmTests = listManifestPmTests(manifest)
    .filter((pmTest) => pmTest.jestTest !== null)
    .length;

  return manifest;
}

/**
 * Lists mappings in `previousManifest` that `manifest` no longer carries.
 *
 * @param {Partial<ParityManifest> | null} previousManifest
 * @param {ParityManifest} manifest
 * @returns {JestMapping[]}
 */
function findOrphanedMappings(previousManifest, manifest) {
  const carried = collectJestMappings(manifest);

  return Array.from(collectJestMappings(previousManifest).values())
    .filter((mapping) => carried.get(mapping.id)?.jestTest !== mapping.jestTest);
}

/**
 * @param {ParityManifest} manifest
 * @returns {string}
 */
function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * @param {string} manifestPath
 * @returns {ParityManifest | null}
 */
function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

/**
 * @param {string[]} argv
 * @returns {{ check: boolean, prune: boolean, collectionPath: string, manifestPath: string }}
 */
function parseArgs(argv) {
  const args = {
    check: false,
    prune: false,
    collectionPath: DEFAULT_COLLECTION_PATH,
    manifestPath: DEFAULT_MANIFEST_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--check') {
      args.check = true;
    } else if (token === '--prune') {
      args.prune = true;
    } else if (token === '--collection' || token === '--manifest') {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error(`Missing value for ${token}`);
      }

      index += 1;
      args[token === '--collection' ? 'collectionPath' : 'manifestPath'] = path.resolve(value);
    } else {
      throw new Error(`Unsupported argument: ${token}`);
    }
  }

  return args;
}

/**
 * @param {ParityManifest} manifest
 * @returns {string}
 */
function formatTotals({ totals }) {
  return `${totals.requests} requests, ${totals.pmTests} pm.test blocks, `
    + `${totals.pmExpectSites} pm.expect sites, ${totals.responseAssertionSites} `
    + `pm.response assertions (${totals.matcherSites} matcher sites), `
    + `${totals.portedPmTests}/${totals.pmTests} ported`;
}

/**
 * @param {JestMapping[]} orphans
 * @returns {string}
 */
function formatOrphans(orphans) {
  return orphans.map((orphan) => `  - ${orphan.id} ("${orphan.name}") -> ${orphan.jestTest}\n`).join('');
}

/**
 * @param {string[]} argv
 * @returns {number} process exit code
 */
function main(argv) {
  const args = parseArgs(argv);
  const previousManifest = readManifest(args.manifestPath);
  const manifest = buildParityManifest({
    collection: readCollection(args.collectionPath),
    previousManifest,
    source: path.relative(ROOT, args.collectionPath),
  });
  const orphans = findOrphanedMappings(previousManifest, manifest);
  const serialized = serializeManifest(manifest);
  const relativeManifestPath = path.relative(process.cwd(), args.manifestPath);

  if (args.check) {
    if (previousManifest && serializeManifest(previousManifest) === serialized) {
      process.stdout.write(`contract:manifest OK ${relativeManifestPath}: ${formatTotals(manifest)}\n`);
      return 0;
    }

    process.stderr.write(
      `contract:manifest STALE ${relativeManifestPath} does not match the collection; `
      + 'run `npm run contract:manifest` and commit the result.\n'
      + (orphans.length > 0 ? `Mappings that would be dropped:\n${formatOrphans(orphans)}` : ''),
    );
    return 1;
  }

  if (orphans.length > 0 && !args.prune) {
    process.stderr.write(
      `contract:manifest REFUSED: ${orphans.length} jestTest mapping(s) no longer match a pm.test `
      + `block by id and name:\n${formatOrphans(orphans)}`
      + 'Re-map them in the manifest, or pass --prune to drop them.\n',
    );
    return 1;
  }

  fs.mkdirSync(path.dirname(args.manifestPath), { recursive: true });
  fs.writeFileSync(args.manifestPath, serialized, 'utf8');
  process.stdout.write(`contract:manifest wrote ${relativeManifestPath}: ${formatTotals(manifest)}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`contract:manifest ${/** @type {Error} */ (error).message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  DEFAULT_COLLECTION_PATH,
  DEFAULT_MANIFEST_PATH,
  SCHEMA_VERSION,
  buildParityManifest,
  findOrphanedMappings,
  main,
  parseArgs,
  serializeManifest,
};
