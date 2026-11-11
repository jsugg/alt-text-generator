const {
  buildCollectionInventory,
  findClosingBracket,
  findStatementEnd,
  inventoryScripts,
  maskLiterals,
  slugify,
} = require('../../../../scripts/contract/collection-inventory');
const { readCollection } = require('../../../../scripts/postman/collection-utils');
const { DEFAULT_COLLECTION_PATH } = require('../../../../scripts/contract/build-parity-manifest');

const testEvent = (exec, listen = 'test') => ({ listen, script: { exec } });
const request = (name, exec, extra = {}) => ({
  name,
  request: { method: 'GET', url: { raw: '{{baseUrl}}/api/ping' }, header: [] },
  event: [testEvent(exec)],
  ...extra,
});

describe('Unit | Scripts | Contract | Collection Inventory', () => {
  describe('maskLiterals', () => {
    it('blanks string, template, regex, and comment contents at identical offsets', () => {
      const source = [
        "pm.test('pm.expect( in a name', function () {",
        '  // pm.expect(commented)',
        '  pm.expect(body.status).to.match(/^(pm\\.expect\\(|x)$/);',
        '  /* pm.test( */ const t = `pm.expect(${value})`;',
        '});',
      ].join('\n');
      const masked = maskLiterals(source);

      expect(masked).toHaveLength(source.length);
      expect(masked.split('\n')).toHaveLength(5);
      expect(masked.match(/pm\.expect\(/gu)).toHaveLength(1);
      expect(masked.match(/pm\.test\(/gu)).toHaveLength(1);
      expect(masked).toContain('${value}');
    });

    it('treats a slash after an operand as division, not a regex', () => {
      const masked = maskLiterals('const ratio = total / count; pm.expect(ratio).to.be.below(2);');

      expect(masked).toContain('pm.expect(ratio)');
    });

    it('treats a slash after a keyword as a regex', () => {
      expect(maskLiterals('return /pm.expect(/u.test(x);')).not.toContain('pm.expect(');
    });
  });

  it('treats a slash after an increment or decrement as division', () => {
    expect(maskLiterals('x = i++ / 2; pm.expect(x); y = j-- / 3;')).toContain('pm.expect(x)');
    expect(maskLiterals('x = a + /pm.expect(/u.source;')).not.toContain('pm.expect(');
  });

  it('matches brackets and statement ends on masked source', () => {
    const masked = maskLiterals("pm.expect(a(')')).to.eql([1, 2]);\nnext();");

    expect(findClosingBracket(masked, masked.indexOf('('))).toBe(masked.indexOf(').to'));
    expect(findStatementEnd(masked, 0)).toBe(masked.indexOf(';'));
    expect(() => findClosingBracket('pm.test(', 7)).toThrow('unbalanced bracket');
  });

  it('slugifies names and drops template expressions', () => {
    expect(slugify('[performance] response time is below ${maxResponseTimeMs}ms'))
      .toBe('performance-response-time-is-below-ms');
  });

  describe('inventoryScripts', () => {
    it('assigns matchers to their innermost pm.test and ids repeated names uniquely', () => {
      const inventory = inventoryScripts({
        event: [
          testEvent([
            'if (pm.response.code === 202) {',
            "  pm.test('stays within budget', function () {",
            '    pm.expect.fail(`pending after ${attempt} polls`);',
            '  });',
            '} else {',
            "  pm.test('stays within budget', function () {",
            '    pm.expect(attempt).to.be.below(max);',
            '    pm.response.to.have.status(200);',
            '  });',
            '}',
            'pm.expect(outside).to.eql(true);',
          ]),
        ],
      }, '90:poll');

      expect(inventory.pmTests.map((block) => block.id)).toEqual([
        '90:poll/stays-within-budget',
        '90:poll/stays-within-budget~2',
      ]);
      expect(inventory.pmTests[0].matchers).toEqual([{
        id: '90:poll/stays-within-budget.1',
        kind: 'pm.expect.fail',
        line: 3,
        source: 'pm.expect.fail(`pending after ${attempt} polls`)',
      }]);
      expect(inventory.pmTests[1].matchers.map((matcher) => matcher.kind))
        .toEqual(['pm.expect', 'pm.response.to']);
      expect(inventory.unownedMatchers).toEqual([expect.objectContaining({
        id: '90:poll/-.1',
        source: 'pm.expect(outside).to.eql(true)',
      })]);
    });

    it('flags dynamic template names and rejects non-literal names', () => {
      const [block] = inventoryScripts({
        event: [testEvent(['pm.test(`status is ${code}`, () => { pm.expect(1).to.eql(1); });'])],
      }, 'collection').pmTests;

      expect(block).toMatchObject({ name: 'status is ${code}', dynamicName: true, event: 'test' });
      expect(inventoryScripts({
        event: [testEvent(["pm.test('status ' + code, () => {});"])],
      }, 'x').pmTests[0]).toMatchObject({ name: 'status ', dynamicName: true });
      expect(() => inventoryScripts({ event: [testEvent(['pm.test(name, () => {});'])] }, 'x'))
        .toThrow('has no literal name');
    });
  });

  describe('buildCollectionInventory', () => {
    it('derives stable request ids, status, and skip declarations', () => {
      const inventory = buildCollectionInventory({
        item: [{
          name: '90 Provider Validation',
          item: [request('Job status', ["pm.test('returns 200', () => { pm.response.to.have.status(200); });"], {
            event: [
              testEvent(['pm.execution.skipRequest();'], 'prerequest'),
              testEvent(["pm.test('returns 200', () => { pm.response.to.have.status(200); });"]),
            ],
          })],
        }],
      });

      expect(inventory.folders[0].requests[0]).toMatchObject({
        id: '90:job-status',
        expectedStatus: 200,
        skippable: true,
        url: '{{baseUrl}}/api/ping',
      });
      expect(inventory.totals).toEqual({
        folders: 1,
        requests: 1,
        pmTests: 1,
        pmExpectSites: 0,
        responseAssertionSites: 1,
        matcherSites: 1,
      });
    });

    it('inventories folder-level and nested sub-folder scripts', () => {
      const inventory = buildCollectionInventory({
        item: [{
          name: '30 Pages',
          event: [testEvent(["pm.test('folder check', () => { pm.expect(1).to.eql(1); });"])],
          item: [{
            name: 'Nested',
            event: [testEvent(["pm.test('nested check', () => {});"])],
            item: [request('Page', [])],
          }],
        }],
      });

      expect(inventory.folders[0].pmTests.map((block) => block.id))
        .toEqual(['30/folder-check', '30/nested-check']);
      expect(inventory.totals).toMatchObject({ requests: 1, pmTests: 2, matcherSites: 1 });
    });

    it('rejects colliding request ids', () => {
      expect(() => buildCollectionInventory({
        item: [{ name: '10 Folder', item: [request('Ping!', []), request('ping', [])] }],
      })).toThrow('duplicate request id "10:ping"');
    });

    it('inventories the committed collection without unowned matchers', () => {
      const inventory = buildCollectionInventory(readCollection(DEFAULT_COLLECTION_PATH));
      const scripts = [
        inventory.collectionScript,
        ...inventory.folders,
        ...inventory.folders.flatMap((folder) => folder.requests),
      ];

      expect(inventory.totals).toEqual({
        folders: 13,
        requests: 45,
        pmTests: 134,
        pmExpectSites: 232,
        responseAssertionSites: 44,
        matcherSites: 276,
      });
      expect(inventory.collectionScript.pmTests).toHaveLength(10);
      expect(scripts.flatMap((script) => script.unownedMatchers)).toEqual([]);
    });
  });
});
