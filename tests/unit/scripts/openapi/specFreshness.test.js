const fs = require('node:fs');
const path = require('node:path');

const {
  checkFreshness,
  parseArgs,
  summarizeDrift,
} = require('../../../../scripts/openapi/check-freshness');
const {
  GENERATED_SPEC_PATH,
  generateFreshSpec,
  readSpecText,
  serializeSpec,
} = require('../../../../scripts/openapi/spec-utils');

describe('Unit | Scripts | OpenAPI | Freshness Check', () => {
  describe('checkFreshness', () => {
    it('reports fresh when committed and generated text are byte-identical', () => {
      const text = serializeSpec({ openapi: '3.0.0', paths: {} });

      expect(checkFreshness({ committedText: text, freshText: text }))
        .toEqual({ fresh: true, drift: null });
    });

    it('reports stale with structural drift when they differ', () => {
      const committed = serializeSpec({
        openapi: '3.0.0',
        paths: { '/ghost': {} },
        components: { schemas: { Old: {} } },
      });
      const fresh = serializeSpec({
        openapi: '3.0.0',
        paths: { '/real': {} },
        components: { schemas: { New: {} } },
      });

      const result = checkFreshness({ committedText: committed, freshText: fresh });

      expect(result.fresh).toBe(false);
      expect(result.drift).toEqual({
        pathsAdded: ['/real'],
        pathsRemoved: ['/ghost'],
        schemasAdded: ['New'],
        schemasRemoved: ['Old'],
      });
    });
  });

  describe('summarizeDrift', () => {
    it('classifies added and removed paths and schemas relative to the fresh sources', () => {
      const committed = { paths: { '/a': {}, '/b': {} }, components: { schemas: { Kept: {}, Dropped: {} } } };
      const fresh = { paths: { '/a': {}, '/c': {} }, components: { schemas: { Kept: {}, Added: {} } } };

      expect(summarizeDrift(committed, fresh)).toEqual({
        pathsAdded: ['/c'],
        pathsRemoved: ['/b'],
        schemasAdded: ['Added'],
        schemasRemoved: ['Dropped'],
      });
    });

    it('tolerates a spec with no components', () => {
      expect(summarizeDrift({ paths: {} }, { paths: { '/x': {} } })).toEqual({
        pathsAdded: ['/x'],
        pathsRemoved: [],
        schemasAdded: [],
        schemasRemoved: [],
      });
    });
  });

  describe('parseArgs', () => {
    it('defaults to the committed artifact', () => {
      expect(parseArgs([])).toEqual({ specPath: GENERATED_SPEC_PATH, json: false, help: false });
    });

    it('parses --json, --help, and --spec', () => {
      expect(parseArgs(['--json']).json).toBe(true);
      expect(parseArgs(['--help']).help).toBe(true);
      expect(parseArgs(['--spec', 'tmp/x.json']).specPath).toBe(path.resolve('tmp/x.json'));
    });

    it('throws on a missing --spec value', () => {
      expect(() => parseArgs(['--spec'])).toThrow('--spec requires a path argument');
    });
  });

  describe('committed artifact', () => {
    it('is exactly what the generator produces (the freshness invariant)', () => {
      expect(fs.existsSync(GENERATED_SPEC_PATH)).toBe(true);
      expect(readSpecText(GENERATED_SPEC_PATH)).toBe(serializeSpec(generateFreshSpec()));
    });
  });
});
