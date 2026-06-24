const fs = require('node:fs');
const path = require('node:path');

const {
  checkFreshness,
  parseArgs,
  summarizeDrift,
} = require('../../../../scripts/openapi/check-freshness');
const {
  GENERATED_SPEC_PATH,
  canonicalizeSpec,
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

  describe('canonicalizeSpec', () => {
    it('sorts object keys recursively', () => {
      const result = canonicalizeSpec({ openapi: '3.0.0', info: { version: '1', title: 'x' } });

      expect(Object.keys(result)).toEqual(['info', 'openapi']);
      expect(Object.keys(result.info)).toEqual(['title', 'version']);
    });

    it('preserves array order and canonicalizes objects nested in arrays', () => {
      const result = canonicalizeSpec({ tags: [{ name: 'b' }, { name: 'a' }], required: ['z', 'a'] });

      expect(result.required).toEqual(['z', 'a']);
      expect(result.tags.map((tag) => tag.name)).toEqual(['b', 'a']);
    });

    it('returns primitives and null unchanged', () => {
      expect(canonicalizeSpec(null)).toBeNull();
      expect(canonicalizeSpec(7)).toBe(7);
      expect(canonicalizeSpec('s')).toBe('s');
    });

    it('is idempotent', () => {
      const canonical = canonicalizeSpec({ b: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] });

      expect(serializeSpec(canonicalizeSpec(canonical))).toBe(serializeSpec(canonical));
    });

    it('makes specs that differ only in key order serialize identically (the generator-version-resilience invariant)', () => {
      const oneEmitOrder = {
        openapi: '3.0.0',
        paths: { '/x': { get: { summary: 's', responses: { default: {} }, tags: ['t'] } } },
      };
      const anotherEmitOrder = {
        paths: { '/x': { get: { tags: ['t'], responses: { default: {} }, summary: 's' } } },
        openapi: '3.0.0',
      };

      expect(serializeSpec(canonicalizeSpec(oneEmitOrder)))
        .toBe(serializeSpec(canonicalizeSpec(anotherEmitOrder)));
    });
  });

  describe('committed artifact', () => {
    it('is exactly what the canonical generator produces (the freshness invariant)', () => {
      expect(fs.existsSync(GENERATED_SPEC_PATH)).toBe(true);
      expect(readSpecText(GENERATED_SPEC_PATH)).toBe(serializeSpec(generateFreshSpec()));
    });
  });
});
