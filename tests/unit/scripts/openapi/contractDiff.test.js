const path = require('node:path');

const {
  DEFAULT_BASE_REFS,
  KINDS,
  diffPublicContract,
  main,
  parseArgs,
  resolveBaseline,
} = require('../../../../scripts/openapi/diff-contract');
const { GENERATED_SPEC_PATH } = require('../../../../scripts/openapi/spec-utils');

const kindsOf = (changes) => changes.map((change) => change.kind);

// A git stub: maps `<ref>:<path>` spec text by ref, throwing for unknown refs
// exactly like `git show` does when a ref or blob is missing.
const gitStub = (textByRef) => (args) => {
  const [, target] = args;
  const ref = target.slice(0, target.indexOf(':'));

  if (!(ref in textByRef)) {
    throw new Error(`fatal: invalid object name '${ref}'`);
  }

  return textByRef[ref];
};

// Silences a CLI write stream for the duration of a main() call.
const withSilencedStreams = (run) => {
  const original = { out: process.stdout.write, err: process.stderr.write };
  process.stdout.write = () => true;
  process.stderr.write = () => true;

  try {
    return run();
  } finally {
    process.stdout.write = original.out;
    process.stderr.write = original.err;
  }
};

describe('Unit | Scripts | OpenAPI | Contract Diff', () => {
  describe('diffPublicContract', () => {
    it('returns no breaking changes for an identical contract', () => {
      const spec = { paths: { '/a': { get: { responses: { 200: {} } } } } };

      expect(diffPublicContract(spec, spec)).toEqual([]);
    });

    it('ignores additive changes (new paths, operations, responses, optional fields)', () => {
      const base = {
        paths: { '/a': { get: { responses: { 200: {} } } } },
        components: { schemas: { Job: { required: ['id'] } } },
      };
      const next = {
        paths: {
          '/a': { get: { responses: { 200: {}, 404: {} } }, post: { responses: { 201: {} } } },
          '/b': { get: { responses: { 200: {} } } },
        },
        components: { schemas: { Job: { required: ['id'] } } },
      };

      expect(diffPublicContract(base, next)).toEqual([]);
    });

    it('flags a removed path', () => {
      const base = { paths: { '/gone': { get: { responses: { 200: {} } } } } };

      expect(diffPublicContract(base, { paths: {} })).toEqual([
        { kind: KINDS.REMOVED_PATH, location: '/gone', detail: 'path removed' },
      ]);
    });

    it('flags a removed operation on a kept path', () => {
      const base = { paths: { '/a': { get: { responses: { 200: {} } }, post: { responses: { 200: {} } } } } };
      const next = { paths: { '/a': { get: { responses: { 200: {} } } } } };

      expect(diffPublicContract(base, next)).toEqual([
        { kind: KINDS.REMOVED_OPERATION, location: 'POST /a', detail: 'operation removed' },
      ]);
    });

    it('flags a removed response on a kept operation', () => {
      const base = { paths: { '/a': { get: { responses: { 200: {}, 404: {} } } } } };
      const next = { paths: { '/a': { get: { responses: { 200: {} } } } } };

      expect(diffPublicContract(base, next)).toEqual([
        { kind: KINDS.REMOVED_RESPONSE, location: 'GET /a', detail: 'response 404 removed' },
      ]);
    });

    it('flags a removed required response property on a kept schema', () => {
      const base = { paths: {}, components: { schemas: { Job: { required: ['jobId', 'status'] } } } };
      const next = { paths: {}, components: { schemas: { Job: { required: ['jobId'] } } } };

      expect(diffPublicContract(base, next)).toEqual([
        {
          kind: KINDS.REMOVED_REQUIRED_PROPERTY,
          location: 'components.schemas.Job',
          detail: 'required property "status" removed',
        },
      ]);
    });

    it('aggregates breaking changes across every category', () => {
      const base = {
        paths: {
          '/keep': { get: { responses: { 200: {}, 404: {} } }, post: { responses: { 200: {} } } },
          '/gone': { get: { responses: { 200: {} } } },
        },
        components: { schemas: { Job: { required: ['jobId', 'status'] } } },
      };
      const next = {
        paths: { '/keep': { get: { responses: { 200: {} } } } },
        components: { schemas: { Job: { required: ['jobId'] } } },
      };

      expect(new Set(kindsOf(diffPublicContract(base, next)))).toEqual(new Set([
        KINDS.REMOVED_RESPONSE,
        KINDS.REMOVED_OPERATION,
        KINDS.REMOVED_PATH,
        KINDS.REMOVED_REQUIRED_PROPERTY,
      ]));
    });
  });

  describe('resolveBaseline', () => {
    it('returns the first ref that yields the spec', () => {
      const runGit = gitStub({ main: '{"paths":{}}' });

      expect(resolveBaseline({ refs: ['origin/main', 'main'], repoRelPath: 'docs/openapi.base.json', runGit }))
        .toEqual({ ref: 'main', text: '{"paths":{}}' });
    });

    it('returns null when no candidate ref resolves', () => {
      const runGit = gitStub({});

      expect(resolveBaseline({ refs: ['origin/main', 'main'], repoRelPath: 'docs/openapi.base.json', runGit }))
        .toBeNull();
    });
  });

  describe('parseArgs', () => {
    it('defaults to no explicit base and the committed artifact', () => {
      expect(parseArgs([])).toEqual({
        base: null,
        specPath: GENERATED_SPEC_PATH,
        strict: false,
        json: false,
        help: false,
      });
    });

    it('parses --base, --spec, --strict, and --json', () => {
      const args = parseArgs(['--base', 'origin/release', '--spec', 'tmp/x.json', '--strict', '--json']);

      expect(args).toEqual({
        base: 'origin/release',
        specPath: path.resolve('tmp/x.json'),
        strict: true,
        json: true,
        help: false,
      });
    });

    it('throws on a missing --base value', () => {
      expect(() => parseArgs(['--base'])).toThrow('--base requires a ref argument');
    });
  });

  describe('main', () => {
    it('skips (exit 0) when no baseline resolves and --strict is absent', () => {
      const code = withSilencedStreams(() => main(['--base', 'ghost'], { runGit: gitStub({}) }));

      expect(code).toBe(0);
    });

    it('fails (exit 1) when no baseline resolves under --strict', () => {
      const code = withSilencedStreams(() => main(['--base', 'ghost', '--strict'], { runGit: gitStub({}) }));

      expect(code).toBe(1);
    });

    it('fails (exit 1) when the working tree drops a path from the baseline', () => {
      const baseline = JSON.stringify({ paths: { '/a': { get: { responses: { 200: {} } } } } });
      const code = withSilencedStreams(() => main(
        ['--base', 'main', '--spec', GENERATED_SPEC_PATH],
        { runGit: gitStub({ main: baseline }) },
      ));

      expect(code).toBe(1);
    });

    it('exposes the default base ref fallback chain', () => {
      expect(DEFAULT_BASE_REFS).toEqual(['origin/main', 'main']);
    });
  });
});
