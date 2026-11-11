const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_COLLECTION_PATH,
  DEFAULT_MANIFEST_PATH,
  buildParityManifest,
  findOrphanedMappings,
  main,
  parseArgs,
  serializeManifest,
} = require('../../../../scripts/contract/build-parity-manifest');
const { readCollection } = require('../../../../scripts/postman/collection-utils');

const COLLECTION = {
  event: [{ listen: 'test', script: { exec: ["pm.test('has request id', () => { pm.expect(id).to.be.a('string'); });"] } }],
  item: [{
    name: '00 Core Smoke',
    item: [{
      name: 'Ping',
      request: { method: 'GET', url: { raw: '{{baseUrl}}/api/ping' }, header: [] },
      event: [{ listen: 'test', script: { exec: ["pm.test('returns 200', () => { pm.response.to.have.status(200); });"] } }],
    }],
  }],
};

const allPmTests = (manifest) => [
  ...manifest.collectionScript.pmTests,
  ...manifest.folders.flatMap((folder) => [
    ...folder.pmTests,
    ...folder.requests.flatMap((request) => request.pmTests),
  ]),
];

describe('Unit | Scripts | Contract | Parity Manifest', () => {
  it('lists every pm.test with an unported Jest mapping by default', () => {
    const manifest = buildParityManifest({ collection: COLLECTION, source: 'collection.json' });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      source: 'collection.json',
      totals: { requests: 1, pmTests: 2, matcherSites: 2, portedPmTests: 0 },
    });
    expect(allPmTests(manifest).map((pmTest) => [pmTest.id, pmTest.jestTest])).toEqual([
      ['collection/has-request-id', null],
      ['00:ping/returns-200', null],
    ]);
  });

  it('carries mappings over by id and name, reporting the ones it cannot keep', () => {
    const previousManifest = buildParityManifest({ collection: COLLECTION });
    previousManifest.folders[0].requests[0].pmTests[0].jestTest = 'Contract | 00 Core Smoke > Ping returns 200';
    previousManifest.collectionScript.pmTests[0].name = 'renamed block';
    previousManifest.collectionScript.pmTests[0].jestTest = 'Contract | stale';
    previousManifest.collectionScript.pmTests.push({ id: 'collection/removed', name: 'removed', jestTest: 'gone' });

    const manifest = buildParityManifest({ collection: COLLECTION, previousManifest });

    expect(manifest.totals.portedPmTests).toBe(1);
    expect(manifest.folders[0].requests[0].pmTests[0].jestTest)
      .toBe('Contract | 00 Core Smoke > Ping returns 200');
    expect(manifest.collectionScript.pmTests[0].jestTest).toBeNull();
    expect(findOrphanedMappings(previousManifest, manifest).map((orphan) => orphan.id))
      .toEqual(['collection/has-request-id', 'collection/removed']);
    expect(findOrphanedMappings(null, manifest)).toEqual([]);
  });

  it('keeps the committed manifest fresh, complete, and uniquely keyed', () => {
    const committed = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, 'utf8'));
    const regenerated = buildParityManifest({
      collection: readCollection(DEFAULT_COLLECTION_PATH),
      previousManifest: committed,
    });
    const ids = [
      ...committed.folders.flatMap((folder) => folder.requests.map((request) => request.id)),
      ...allPmTests(committed).flatMap((pmTest) => [
        pmTest.id,
        ...pmTest.matchers.map((matcher) => matcher.id),
      ]),
    ];

    expect(serializeManifest(regenerated)).toBe(fs.readFileSync(DEFAULT_MANIFEST_PATH, 'utf8'));
    expect(committed.totals).toMatchObject({
      requests: 45,
      pmTests: 134,
      pmExpectSites: 232,
      responseAssertionSites: 44,
      matcherSites: 276,
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('main', () => {
    let tempDir;
    let collectionPath;
    let manifestPath;
    let stdout;
    let stderr;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-manifest-test-'));
      collectionPath = path.join(tempDir, 'collection.json');
      manifestPath = path.join(tempDir, 'nested', 'manifest.json');
      fs.writeFileSync(collectionPath, JSON.stringify(COLLECTION));
      stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    it('writes the manifest, then passes --check until the collection drifts', () => {
      const args = ['--collection', collectionPath, '--manifest', manifestPath];

      expect(main(['--check', ...args])).toBe(1);
      expect(main(args)).toBe(0);
      expect(main(['--check', ...args])).toBe(0);
      expect(stdout.mock.calls.flat().join('')).toContain('2 pm.test blocks');

      fs.writeFileSync(collectionPath, JSON.stringify({ ...COLLECTION, event: [] }));

      expect(main(['--check', ...args])).toBe(1);
      expect(stderr.mock.calls.flat().join('')).toContain('contract:manifest STALE');
    });

    it('refuses to drop a Jest mapping unless --prune is passed', () => {
      const args = ['--collection', collectionPath, '--manifest', manifestPath];
      main(args);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.collectionScript.pmTests[0].jestTest = 'Contract | has request id';
      fs.writeFileSync(manifestPath, serializeManifest(manifest));
      fs.writeFileSync(collectionPath, JSON.stringify({ ...COLLECTION, event: [] }));

      expect(main(['--check', ...args])).toBe(1);
      expect(stderr.mock.calls.flat().join('')).toContain('collection/has-request-id');
      expect(main(args)).toBe(1);
      expect(stderr.mock.calls.flat().join('')).toContain('contract:manifest REFUSED: 1 jestTest mapping(s)');
      expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).collectionScript.pmTests).toHaveLength(1);
      expect(main(['--prune', ...args])).toBe(0);
      expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).collectionScript.pmTests).toEqual([]);
    });
  });

  it('parses flags and rejects unknown or incomplete arguments', () => {
    expect(parseArgs(['--check', '--prune', '--manifest', 'm.json'])).toMatchObject({
      check: true,
      prune: true,
      manifestPath: path.resolve('m.json'),
      collectionPath: DEFAULT_COLLECTION_PATH,
    });
    expect(() => parseArgs(['--collection'])).toThrow('Missing value for --collection');
    expect(() => parseArgs(['--nope'])).toThrow('Unsupported argument: --nope');
  });
});
