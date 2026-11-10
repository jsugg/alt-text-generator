const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_POSTMAN_DIR,
  POLICY_RULES,
  findDynamicVariableViolations,
  lintPostmanFiles,
  listPostmanJsonFiles,
} = require('../../../../scripts/postman/dynamic-variable-policy');

describe('Unit | Scripts | Postman | Dynamic Variable Policy', () => {
  describe('findDynamicVariableViolations', () => {
    it('accepts ordinary Postman variables and scripts', () => {
      expect(findDynamicVariableViolations({
        request: { url: { raw: '{{baseUrl}}/api/ping' }, body: { raw: '{"id":"{{jobId}}"}' } },
        event: [{ script: { exec: ['const id = pm.variables.get("jobId");'] } }],
      }, 'c')).toEqual([]);
    });

    it.each([
      ['a request URL', { url: { raw: '{{baseUrl}}/{{$randomUUID}}' } }, '/url/raw'],
      ['a header with inner whitespace', { header: [{ value: '{{ $timestamp }}' }] }, '/header/0/value'],
      ['a body', { body: { raw: '{"name":"{{$randomFullName}}"}' } }, '/body/raw'],
      ['an environment value', { values: [{ value: '{{$guid}}' }] }, '/values/0/value'],
      ['a script line', { exec: ['pm.environment.set("x", "{{$randomInt}}");'] }, '/exec/0'],
    ])('rejects a dynamic variable in %s', (_label, document, pointer) => {
      expect(findDynamicVariableViolations(document, 'c')).toEqual([expect.objectContaining({
        rule: POLICY_RULES.DYNAMIC_VARIABLES,
        location: `c#${pointer}`,
      })]);
    });

    it.each([
      'const v = pm.variables.replaceIn(template);',
      'const vars = pm.variables; vars.replaceIn(t);',
      "pm.variables['replaceIn'](t);",
    ])('rejects replaceIn in %j', (line) => {
      expect(findDynamicVariableViolations({ exec: [line] }, 'c')).toEqual([expect.objectContaining({
        rule: POLICY_RULES.TEMPLATE_REPLACE_IN,
        location: 'c#/exec/0',
      })]);
    });

    it('escapes JSON pointer tokens', () => {
      expect(findDynamicVariableViolations({ 'a/b~c': '{{$guid}}' }, 'c')[0].location)
        .toBe('c#/a~1b~0c');
    });

    it('reports the document root for a bare string', () => {
      expect(findDynamicVariableViolations('{{$guid}}', 'c')[0].location).toBe('c#/');
    });
  });

  describe('files', () => {
    it('lists every JSON file under a directory tree, sorted', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postman-policy-'));

      try {
        fs.mkdirSync(path.join(dir, 'nested'));
        fs.writeFileSync(path.join(dir, 'b.json'), '{}');
        fs.writeFileSync(path.join(dir, 'nested', 'a.json'), '{"x":"{{$guid}}"}');
        fs.writeFileSync(path.join(dir, 'notes.md'), '{{$guid}}');

        const files = listPostmanJsonFiles(dir);

        expect(files).toEqual([path.join(dir, 'b.json'), path.join(dir, 'nested', 'a.json')]);
        expect(lintPostmanFiles(files, dir)).toEqual([expect.objectContaining({
          rule: POLICY_RULES.DYNAMIC_VARIABLES,
          location: `${path.join('nested', 'a.json')}#/x`,
        })]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('keeps the committed collection and environments free of dynamic variables', () => {
      const files = listPostmanJsonFiles(DEFAULT_POSTMAN_DIR);

      expect(files.map((file) => path.relative(DEFAULT_POSTMAN_DIR, file))).toEqual(
        expect.arrayContaining([
          path.join('collections', 'alt-text-generator.postman_collection.json'),
          path.join('environments', 'alt-text-generator.local.postman_environment.json'),
          path.join('environments', 'alt-text-generator.live.postman_environment.json'),
        ]),
      );
      expect(lintPostmanFiles(files)).toEqual([]);
    });
  });
});
