const path = require('node:path');

const {
  DEFAULT_COLLECTION_PATH,
  RULES,
  getRequestUrl,
  lintCollection,
  lintErrorContract,
  lintFolderNames,
  lintForbiddenUrls,
  lintRequestNames,
  lintStatusExpectations,
  parseArgs,
  summarize,
} = require('../../../../scripts/postman/lint-collection');
const { readCollection } = require('../../../../scripts/postman/collection-utils');

const DEFAULT_URL = { raw: '{{baseUrl}}/api/ping', host: ['{{baseUrl}}'] };

const req = (name, {
  status = 200,
  url = DEFAULT_URL,
  exec,
} = {}) => ({
  name,
  request: {
    method: 'GET',
    header: status === null ? [] : [{ key: 'X-Expected-Status-Code', value: String(status) }],
    url,
  },
  event: exec ? [{ listen: 'test', script: { type: 'text/javascript', exec } }] : [],
});

const folder = (name, items) => ({ name, item: items });
const collectionOf = (...folders) => ({ item: folders });

const rulesOf = (violations) => violations.map((violation) => violation.rule);
const locationsOf = (violations) => violations.map((violation) => violation.location);

describe('Unit | Scripts | Postman | Collection Lint', () => {
  describe('lintFolderNames', () => {
    it('accepts two-digit, unique, ascending folder prefixes', () => {
      const collection = collectionOf(
        folder('00 Core Smoke', [req('Ping')]),
        folder('10 Scraper Contract', [req('Scrape')]),
      );

      expect(lintFolderNames(collection)).toEqual([]);
    });

    it('flags folder names without a two-digit order prefix', () => {
      const violations = lintFolderNames(collectionOf(folder('Core Smoke', [req('Ping')])));

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: RULES.FOLDER_NAMES,
        location: 'Core Smoke',
      });
      expect(violations[0].message).toContain('two-digit order prefix');
    });

    it('flags duplicate order prefixes', () => {
      const violations = lintFolderNames(collectionOf(
        folder('10 Alpha', [req('A')]),
        folder('10 Beta', [req('B')]),
      ));

      expect(violations.some((violation) => violation.message.includes('duplicate folder order prefix')))
        .toBe(true);
    });

    it('flags folders that break ascending order', () => {
      const violations = lintFolderNames(collectionOf(
        folder('10 Alpha', [req('A')]),
        folder('05 Beta', [req('B')]),
      ));

      expect(violations.some((violation) => violation.message.includes('ascending order'))).toBe(true);
    });

    it('flags duplicate top-level folder names', () => {
      const violations = lintFolderNames(collectionOf(
        folder('10 Alpha', [req('A')]),
        folder('10 Alpha', [req('B')]),
      ));

      expect(violations.some((violation) => violation.message.includes('duplicate top-level folder name')))
        .toBe(true);
    });
  });

  describe('lintRequestNames', () => {
    it('accepts unique, trimmed request names within a folder', () => {
      const collection = collectionOf(folder('00 Core', [req('Ping'), req('Health')]));

      expect(lintRequestNames(collection)).toEqual([]);
    });

    it('flags duplicate request names within the same folder', () => {
      const violations = lintRequestNames(collectionOf(
        folder('00 Core', [req('Ping'), req('Ping')]),
      ));

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: RULES.REQUEST_NAMES,
        location: '00 Core > Ping',
      });
      expect(violations[0].message).toContain('duplicate request name');
    });

    it('flags empty and whitespace-padded request names', () => {
      const violations = lintRequestNames(collectionOf(
        folder('00 Core', [req(''), req(' Padded ')]),
      ));

      expect(violations.some((violation) => violation.message.includes('non-empty string'))).toBe(true);
      expect(violations.some((violation) => violation.message.includes('leading or trailing whitespace')))
        .toBe(true);
    });
  });

  describe('lintStatusExpectations', () => {
    it('accepts requests with an X-Expected-Status-Code header', () => {
      expect(lintStatusExpectations(collectionOf(folder('00 Core', [req('Ping', { status: 200 })]))))
        .toEqual([]);
    });

    it('accepts requests with an inline status assertion but no header', () => {
      const collection = collectionOf(folder('00 Core', [
        req('Ping', { status: null, exec: ['pm.response.to.have.status(200);'] }),
      ]));

      expect(lintStatusExpectations(collection)).toEqual([]);
    });

    it('flags requests with no exact status expectation', () => {
      const collection = collectionOf(folder('00 Core', [req('Ping', { status: null })]));
      const violations = lintStatusExpectations(collection);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: RULES.STATUS_EXPECTATIONS,
        location: '00 Core > Ping',
      });
    });
  });

  describe('lintErrorContract', () => {
    it('accepts 4xx/5xx requests that assert the public error body', () => {
      const collection = collectionOf(folder('40 Negative', [
        req('Missing auth', {
          status: 401,
          exec: ["pm.test('contract', function () { pm.expect(body.error).to.eql('nope'); });"],
        }),
      ]));

      expect(lintErrorContract(collection)).toEqual([]);
    });

    it('flags 5xx requests that only assert the status', () => {
      const collection = collectionOf(folder('20 Stub', [
        req('Outage', { status: 500, exec: ['pm.response.to.have.status(500);'] }),
      ]));
      const violations = lintErrorContract(collection);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: RULES.ERROR_CONTRACT,
        location: '20 Stub > Outage',
      });
      expect(violations[0].message).toContain('500 response must assert');
    });

    it('ignores 2xx/3xx requests', () => {
      const collection = collectionOf(folder('00 Core', [
        req('Ping', { status: 200 }),
        req('Redirect', { status: 302 }),
      ]));

      expect(lintErrorContract(collection)).toEqual([]);
    });
  });

  describe('lintForbiddenUrls', () => {
    it('accepts variable-host URLs, including chained path variables', () => {
      const collection = collectionOf(folder('00 Core', [
        req('Ping'),
        req('Poll', { url: '{{baseUrl}}{{jobStatusUrl}}' }),
      ]));

      expect(lintForbiddenUrls(collection)).toEqual([]);
    });

    it('flags hardcoded live hosts on every applicable check', () => {
      const collection = collectionOf(folder('90 Provider', [
        req('Leak', {
          url: { raw: 'https://api.replicate.com/v1/predictions', host: ['api', 'replicate', 'com'] },
        }),
      ]));
      const violations = lintForbiddenUrls(collection);

      expect(violations).toHaveLength(3);
      expect(violations.every((violation) => violation.rule === RULES.FORBIDDEN_URLS)).toBe(true);
      expect(locationsOf(violations)).toEqual([
        '90 Provider > Leak',
        '90 Provider > Leak',
        '90 Provider > Leak',
      ]);
      expect(violations.some((violation) => violation.message.includes('must be a Postman variable')))
        .toBe(true);
      expect(violations.some((violation) => violation.message.includes('hardcode an http(s) host')))
        .toBe(true);
      expect(violations.some((violation) => violation.message.includes('forbidden live host token')))
        .toBe(true);
    });

    it('flags a private-network host token', () => {
      const collection = collectionOf(folder('90 Provider', [
        req('Metadata', { url: 'http://169.254.169.254/latest/meta-data' }),
      ]));

      expect(lintForbiddenUrls(collection).some(
        (violation) => violation.message.includes('169.254.169.254'),
      )).toBe(true);
    });
  });

  describe('getRequestUrl', () => {
    it('reads string and object URL shapes', () => {
      expect(getRequestUrl({ request: { url: '{{baseUrl}}/x' } }))
        .toEqual({ raw: '{{baseUrl}}/x', host: '' });
      expect(getRequestUrl({ request: { url: { raw: '{{baseUrl}}/x', host: ['{{baseUrl}}'] } } }))
        .toEqual({ raw: '{{baseUrl}}/x', host: '{{baseUrl}}' });
    });
  });

  describe('lintCollection', () => {
    it('aggregates violations from every rule with folder/request locations', () => {
      const collection = collectionOf(
        folder('Bad Folder', [
          req('Leak', {
            status: 401,
            url: { raw: 'https://wcag.qcraft.com.br/x', host: ['wcag', 'qcraft', 'com', 'br'] },
            exec: ['pm.response.to.have.status(401);'],
          }),
        ]),
      );
      const violations = lintCollection(collection);
      const rules = new Set(rulesOf(violations));

      expect(rules.has(RULES.FOLDER_NAMES)).toBe(true);
      expect(rules.has(RULES.ERROR_CONTRACT)).toBe(true);
      expect(rules.has(RULES.FORBIDDEN_URLS)).toBe(true);
      violations.forEach((violation) => {
        expect(typeof violation.location).toBe('string');
        expect(violation.location.length).toBeGreaterThan(0);
      });
    });
  });

  describe('summarize', () => {
    it('counts folders and requests', () => {
      const collection = collectionOf(
        folder('00 Core', [req('Ping'), req('Health')]),
        folder('10 Scraper', [req('Scrape')]),
      );

      expect(summarize(collection)).toEqual({ folders: 2, requests: 3 });
    });
  });

  describe('parseArgs', () => {
    it('defaults to the committed collection', () => {
      expect(parseArgs([])).toEqual({
        collectionPath: DEFAULT_COLLECTION_PATH,
        json: false,
        help: false,
      });
    });

    it('parses --json, --help, and --collection', () => {
      expect(parseArgs(['--json']).json).toBe(true);
      expect(parseArgs(['--help']).help).toBe(true);
      expect(parseArgs(['--collection', 'tmp/x.json']).collectionPath)
        .toBe(path.resolve('tmp/x.json'));
    });

    it('throws on unknown arguments and a missing --collection value', () => {
      expect(() => parseArgs(['--bogus'])).toThrow('Unknown argument: --bogus');
      expect(() => parseArgs(['--collection'])).toThrow('--collection requires a path argument');
    });
  });

  describe('committed collection', () => {
    it('passes every policy rule', () => {
      const collection = readCollection(DEFAULT_COLLECTION_PATH);

      expect(lintCollection(collection)).toEqual([]);
    });
  });
});
