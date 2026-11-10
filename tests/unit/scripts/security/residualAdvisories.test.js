const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkExpiry } = require('../../../../scripts/docs/validate-docs');
const {
  assertCompleteAudit,
  checkAudit,
  checkDocs,
  distinctAdvisories,
  lockfileSha256,
  main,
  overrideMismatches,
  renderDoc,
} = require('../../../../scripts/security/residual-advisories');

const manifest = require('../../../../config/security/residual-advisories.json');

/**
 * Shapes a minimal `npm audit --json` payload: the fields this script reads.
 *
 * @param {Array<{ id: string, name: string, severity: string, title: string }>} advisories
 * @param {object} [totals]
 */
const auditFixture = (advisories, totals = {}) => ({
  vulnerabilities: Object.fromEntries(
    advisories.map((a) => [a.name, {
      name: a.name,
      severity: a.severity,
      via: [{
        url: `https://github.com/advisories/${a.id}`,
        name: a.name,
        severity: a.severity,
        title: a.title,
      }],
    }]),
  ),
  metadata: {
    vulnerabilities: {
      info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...totals,
    },
  },
});

const APPROVED = [
  {
    id: 'GHSA-test1',
    name: 'fixture-one',
    severity: 'moderate',
    title: 'First approved fixture',
  },
  {
    id: 'GHSA-test2',
    name: 'fixture-two',
    severity: 'moderate',
    title: 'Second approved fixture',
  },
];
const TEST_MANIFEST = {
  ...manifest,
  accepted: APPROVED.map((entry) => ({
    advisory: entry.id,
    package: entry.name,
  })),
};

describe('Unit | Scripts | Security | Residual Advisories', () => {
  let logs;

  beforeEach(() => {
    logs = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
  });

  describe('the committed state', () => {
    it('keeps the document and package.json in step with the manifest', () => {
      const schemaPath = path.resolve(
        __dirname,
        '../../../../config/security',
        manifest.$schema,
      );

      expect(fs.existsSync(schemaPath)).toBe(true);
      expect(overrideMismatches(manifest)).toEqual([]);
      expect(checkDocs()).toBe(0);
    });

    it('records auditable verification metadata without coupling every dependency PR to it', () => {
      expect(manifest.accepted).toEqual([]);
      expect(manifest.lockfileSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(lockfileSha256()).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('distinctAdvisories', () => {
    it('deduplicates one advisory reported through several packages', () => {
      const audit = auditFixture([
        { id: 'GHSA-aaaa', name: 'uuid', severity: 'moderate', title: 'Bounds' },
      ]);

      audit.vulnerabilities['postman-collection'] = {
        name: 'postman-collection',
        severity: 'moderate',
        via: [
          'uuid',
          {
            url: 'https://github.com/advisories/GHSA-aaaa', name: 'uuid', severity: 'moderate', title: 'Bounds',
          },
        ],
      };

      expect([...distinctAdvisories(audit).keys()]).toEqual(['GHSA-aaaa']);
    });
  });

  describe('checkAudit fail policy', () => {
    /** @type {string} */
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'residual-audit-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const writeAudit = (payload) => {
      const file = path.join(dir, 'npm-audit.json');

      fs.writeFileSync(file, JSON.stringify(payload));
      return file;
    };
    const extra = (severity) => ({
      id: `GHSA-new-${severity}`, name: `pkg-${severity}`, severity, title: `Unapproved ${severity}`,
    });
    const output = () => logs.join('');

    it('passes when reality matches the approved manifest', () => {
      expect(checkAudit(writeAudit(auditFixture(APPROVED, { moderate: 2, total: 2 })), TEST_MANIFEST))
        .toBe(0);
      expect(output()).toContain('OK no unapproved advisory at or above high; 0 lower-severity reported');
    });

    it.each(['high', 'critical'])('fails on an unapproved %s advisory', (severity) => {
      const file = writeAudit(auditFixture([...APPROVED, extra(severity)], { [severity]: 1, total: 3 }));

      expect(checkAudit(file, TEST_MANIFEST)).toBe(1);
      expect(output()).toContain(`BLOCKING unapproved ${severity} pkg-${severity} GHSA-new-${severity}`);
    });

    it.each(['low', 'moderate'])('passes an unapproved %s advisory and reports it', (severity) => {
      const file = writeAudit(auditFixture([...APPROVED, extra(severity)], { [severity]: 1, total: 3 }));

      expect(checkAudit(file, TEST_MANIFEST)).toBe(0);
      expect(output()).toContain(`REPORTED unapproved ${severity} pkg-${severity} GHSA-new-${severity}`);
      expect(output()).toContain('1 lower-severity reported');
    });

    it('passes an accepted high advisory: acceptance is time-boxed by its expiry instead', () => {
      const acceptedHigh = { ...APPROVED[0], severity: 'high' };
      const file = writeAudit(auditFixture([acceptedHigh, APPROVED[1]], { high: 1, moderate: 1, total: 2 }));

      expect(checkAudit(file, TEST_MANIFEST)).toBe(0);
    });

    // An entry upstream has fixed must be removed, not left implying live risk.
    it('fails when an accepted advisory is no longer reported', () => {
      expect(checkAudit(writeAudit(auditFixture(APPROVED.slice(0, 1), { moderate: 1, total: 1 })), TEST_MANIFEST))
        .toBe(1);
      expect(output()).toContain('BLOCKING stale GHSA-test2 is approved in the manifest but no longer reported');
    });

    it('honours a stricter threshold', () => {
      const file = writeAudit(auditFixture([...APPROVED, extra('moderate')], { moderate: 3, total: 3 }));

      expect(checkAudit(file, TEST_MANIFEST, { failOn: 'moderate' })).toBe(1);
    });

    it('treats an unknown advisory severity as critical', () => {
      const file = writeAudit(auditFixture([...APPROVED, extra('unrated')], { total: 3 }));

      expect(checkAudit(file, TEST_MANIFEST)).toBe(1);
    });
  });

  describe('audit file input', () => {
    it.each([
      ['a parse-error fallback', { metadata: { vulnerabilities: {} }, parseError: 'Unexpected token' }],
      ['missing counts', { vulnerabilities: {} }],
      ['partial counts', { metadata: { vulnerabilities: { high: 0 } } }],
    ])('rejects %s', (_label, payload) => {
      expect(() => assertCompleteAudit(payload, 'report.json'))
        .toThrow('report.json is not a complete npm audit report');
    });

    it('accepts a complete report', () => {
      const payload = auditFixture([], {});

      expect(assertCompleteAudit(payload, 'report.json')).toBe(payload);
    });
  });

  describe('main --check-audit', () => {
    /** @type {string} */
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'residual-main-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const auditWith = (advisories) => {
      const file = path.join(dir, 'npm-audit.json');

      fs.writeFileSync(file, JSON.stringify(auditFixture(advisories)));
      return file;
    };

    // The committed manifest accepts nothing, so any reported advisory is unapproved.
    it.each([
      ['--audit-file=<file> --fail-on=high', (file) => [`--audit-file=${file}`, '--fail-on=high']],
      ['--audit-file <file> --fail-on high', (file) => ['--audit-file', file, '--fail-on', 'high']],
    ])('reads %s', (_label, args) => {
      const file = auditWith([{ id: 'GHSA-x', name: 'x', severity: 'moderate', title: 'x' }]);

      expect(main(['--check-audit', ...args(file)])).toBe(0);
      expect(logs.join('')).toContain('REPORTED unapproved moderate x GHSA-x');
    });

    it('defaults the threshold to high', () => {
      const file = auditWith([{ id: 'GHSA-y', name: 'y', severity: 'high', title: 'y' }]);

      expect(main(['--check-audit', '--audit-file', file])).toBe(1);
      expect(logs.join('')).toContain('fail policy: unapproved >= high');
    });

    it('rejects an unknown threshold', () => {
      expect(main(['--check-audit', '--fail-on=severe'])).toBe(2);
      expect(logs.join('')).toContain('--fail-on must be one of');
    });

    it('exits 2 on an incomplete audit file instead of passing', () => {
      const file = path.join(dir, 'npm-audit.json');
      fs.writeFileSync(file, JSON.stringify({ metadata: { vulnerabilities: {} }, parseError: 'boom' }));

      expect(main(['--check-audit', '--audit-file', file])).toBe(2);
      expect(logs.join('')).toContain('is not a complete npm audit report');
    });
  });

  describe('accepted entry expiry', () => {
    const acceptedEntry = (expires) => ({
      advisory: 'GHSA-abcd-efgh-ijkl',
      package: 'fixture-pkg',
      severity: 'high',
      title: 'Fixture advisory',
      pulledBy: ['newman'],
      productionReachable: false,
      why: 'Fixture reason.',
      ...(expires === undefined ? {} : { expires }),
    });

    it('renders the expiry so the docs gate can enforce it', () => {
      const content = renderDoc({ ...manifest, accepted: [acceptedEntry('2027-01-31')] });

      expect(content).toContain('Fixture reason. Expiry: 2027-01-31.');
      expect(checkExpiry(content, 'docs/dependency-security.md', new Date('2027-01-15'))).toEqual([]);
    });

    it('fails the docs gate once an accepted entry expires', () => {
      const content = renderDoc({ ...manifest, accepted: [acceptedEntry('2027-01-31')] });

      expect(checkExpiry(content, 'docs/dependency-security.md', new Date('2027-02-01'))).toEqual([
        expect.objectContaining({ message: expect.stringContaining('Documented Expiry 2027-01-31 has passed') }),
      ]);
    });

    it.each([[undefined], ['soon'], ['2027-13-45']])('refuses to render an entry with expires %j', (expires) => {
      expect(() => renderDoc({ ...manifest, accepted: [acceptedEntry(expires)] }))
        .toThrow('accepted advisory GHSA-abcd-efgh-ijkl needs an expires date (YYYY-MM-DD)');
    });

    it('requires expires in the schema', () => {
      const schema = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../../../../config/security/residual-advisories.schema.json'),
        'utf8',
      ));
      const item = schema.properties.accepted.items;

      expect(item.required).toContain('expires');
      expect(item.properties.expires).toMatchObject({ type: 'string', format: 'date' });
    });
  });
});
