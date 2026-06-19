const path = require('node:path');

const {
  RULES,
  parseArgs,
  summarize,
  validateInfo,
  validateNoServers,
  validateOperationResponses,
  validateRefs,
  validateSecurity,
  validateSpec,
  validateVersion,
} = require('../../../../scripts/openapi/validate-spec');
const { GENERATED_SPEC_PATH, loadSpec } = require('../../../../scripts/openapi/spec-utils');

// A minimal spec that satisfies every structural rule. Each test clones and
// mutates it so a single broken invariant is isolated from the others.
const validSpec = () => ({
  openapi: '3.0.0',
  info: { title: 'API', version: '1.0.0' },
  paths: {
    '/health': { get: { responses: { 200: { description: 'ok' } } } },
    '/items': {
      get: {
        security: [{ bearerAuth: [] }],
        responses: {
          200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: { Item: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  },
});

const rulesOf = (violations) => violations.map((violation) => violation.rule);

describe('Unit | Scripts | OpenAPI | Validate Spec', () => {
  describe('validateSpec', () => {
    it('returns no violations for a structurally sound spec', () => {
      expect(validateSpec(validSpec())).toEqual([]);
    });
  });

  describe('validateVersion', () => {
    it('accepts a 3.x version', () => {
      expect(validateVersion({ openapi: '3.0.0' })).toEqual([]);
    });

    it('flags a missing or non-3.x version', () => {
      expect(rulesOf(validateVersion({}))).toEqual([RULES.OPENAPI_VERSION]);
      expect(rulesOf(validateVersion({ openapi: '2.0' }))).toEqual([RULES.OPENAPI_VERSION]);
    });
  });

  describe('validateInfo', () => {
    it('flags empty title and version independently', () => {
      const violations = validateInfo({ info: { title: '  ', version: '' } });

      expect(violations).toHaveLength(2);
      expect(violations.map((violation) => violation.location))
        .toEqual(['info.title', 'info.version']);
    });
  });

  describe('validateNoServers', () => {
    it('flags an embedded servers block on the base artifact', () => {
      const violations = validateNoServers({ servers: [{ url: 'https://x' }] });

      expect(rulesOf(violations)).toEqual([RULES.NO_RUNTIME_SERVERS]);
    });

    it('accepts a server-agnostic base artifact', () => {
      expect(validateNoServers({})).toEqual([]);
    });
  });

  describe('validateOperationResponses', () => {
    it('flags an operation with no responses', () => {
      const spec = validSpec();
      spec.paths['/items'].get.responses = {};

      const violations = validateOperationResponses(spec);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: RULES.OPERATION_RESPONSES,
        location: 'GET /items',
      });
    });

    it('flags a JSON response body without a schema', () => {
      const spec = validSpec();
      delete spec.paths['/items'].get.responses['200'].content['application/json'].schema;

      const violations = validateOperationResponses(spec);

      expect(violations).toHaveLength(1);
      expect(violations[0].location).toBe('GET /items 200 application/json');
    });
  });

  describe('validateRefs', () => {
    it('flags a $ref that does not resolve', () => {
      const spec = validSpec();
      spec.paths['/items'].get.responses['200'].content['application/json'].schema = {
        $ref: '#/components/schemas/Missing',
      };

      const violations = validateRefs(spec);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: RULES.RESOLVABLE_REFS,
        location: '#/components/schemas/Missing',
      });
    });

    it('resolves refs to existing components', () => {
      expect(validateRefs(validSpec())).toEqual([]);
    });
  });

  describe('validateSecurity', () => {
    it('flags a security requirement naming an undeclared scheme', () => {
      const spec = validSpec();
      spec.paths['/items'].get.security = [{ ghostAuth: [] }];

      const violations = validateSecurity(spec);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: RULES.SECURITY_RESOLVABLE,
        location: 'GET /items',
      });
      expect(violations[0].message).toContain('ghostAuth');
    });

    it('accepts requirements that name declared schemes', () => {
      expect(validateSecurity(validSpec())).toEqual([]);
    });
  });

  describe('summarize', () => {
    it('counts paths and operations', () => {
      expect(summarize(validSpec())).toEqual({ paths: 2, operations: 2 });
    });
  });

  describe('parseArgs', () => {
    it('defaults to the committed artifact', () => {
      expect(parseArgs([])).toEqual({
        specPath: GENERATED_SPEC_PATH,
        json: false,
        help: false,
      });
    });

    it('parses --json, --help, and --spec', () => {
      expect(parseArgs(['--json']).json).toBe(true);
      expect(parseArgs(['--help']).help).toBe(true);
      expect(parseArgs(['--spec', 'tmp/x.json']).specPath).toBe(path.resolve('tmp/x.json'));
    });

    it('throws on unknown arguments and a missing --spec value', () => {
      expect(() => parseArgs(['--bogus'])).toThrow('Unknown argument: --bogus');
      expect(() => parseArgs(['--spec'])).toThrow('--spec requires a path argument');
    });
  });

  describe('committed artifact', () => {
    it('is a structurally valid OpenAPI 3 document', () => {
      expect(validateSpec(loadSpec(GENERATED_SPEC_PATH))).toEqual([]);
    });
  });
});
