const {
  checkAudit,
  checkDocs,
  distinctAdvisories,
  lockfileSha256,
  overrideMismatches,
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

const APPROVED = manifest.accepted.map((/** @type {any} */ e) => ({
  id: e.advisory,
  name: e.package,
  severity: e.severity,
  title: e.title,
}));

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
      expect(overrideMismatches(manifest)).toEqual([]);
      expect(checkDocs()).toBe(0);
    });

    it('records the lockfile it was verified against', () => {
      expect(manifest.lockfileSha256).toBe(lockfileSha256());
      expect(manifest.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

  describe('checkAudit', () => {
    const withAudit = (payload, fn) => {
      const file = `${global.__dirname ?? process.cwd()}/.residual-audit-fixture.json`;

      require('node:fs').writeFileSync(file, JSON.stringify(payload));

      try {
        return fn(file);
      } finally {
        require('node:fs').rmSync(file, { force: true });
      }
    };

    it('passes when reality matches the approved manifest', () => {
      withAudit(auditFixture(APPROVED, { moderate: APPROVED.length, total: APPROVED.length }), (file) => {
        expect(checkAudit(file)).toBe(0);
      });

      expect(logs.join('')).toContain('OK reality matches the approved manifest');
    });

    it('fails on an advisory nobody approved', () => {
      const audit = auditFixture(
        [...APPROVED, {
          id: 'GHSA-new1', name: 'left-pad', severity: 'moderate', title: 'Surprise',
        }],
        { moderate: 3, total: 3 },
      );

      withAudit(audit, (file) => {
        expect(checkAudit(file)).toBe(1);
      });

      expect(logs.join('')).toContain('UNAPPROVED moderate left-pad GHSA-new1');
    });

    // The manifest going stale in the other direction still needs a human: an
    // entry upstream has fixed should be removed, not left implying live risk.
    it('fails when an approved advisory is no longer reported', () => {
      withAudit(auditFixture(APPROVED.slice(0, 1), { moderate: 1, total: 1 }), (file) => {
        expect(checkAudit(file)).toBe(1);
      });

      expect(logs.join('')).toContain('is approved in the manifest but no longer reported');
    });

    it('fails on any high or critical, approved or not', () => {
      withAudit(auditFixture(APPROVED, { critical: 1, total: 3 }), (file) => {
        expect(checkAudit(file)).toBe(1);
      });

      expect(logs.join('')).toContain('1 high/critical advisory(ies) present');
    });
  });
});
