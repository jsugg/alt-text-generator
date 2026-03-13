const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendOutput,
  parseArgs,
  parseSecurityAuditReport,
} = require('../../../../scripts/github/parse-security-audit-report');

describe('Unit | Scripts | GitHub | Parse Security Audit Report', () => {
  describe('parseArgs', () => {
    it('parses the required arguments', () => {
      expect(parseArgs([
        '--report-file',
        'reports/security/npm-audit.json',
        '--output-file',
        '/tmp/github-output.txt',
      ])).toEqual({
        outputFile: '/tmp/github-output.txt',
        reportFile: 'reports/security/npm-audit.json',
      });
    });

    it('rejects unsupported and incomplete arguments', () => {
      expect(() => parseArgs([
        '--report-file',
        'reports/security/npm-audit.json',
      ])).toThrow('--report-file and --output-file are required');

      expect(() => parseArgs([
        '--report-file',
        'reports/security/npm-audit.json',
        '--output-file',
      ])).toThrow('Missing value for --output-file');

      expect(() => parseArgs([
        '--report-file',
        'reports/security/npm-audit.json',
        '--output-file',
        '/tmp/github-output.txt',
        '--unknown',
        'value',
      ])).toThrow('Unsupported argument: --unknown');
    });
  });

  describe('appendOutput', () => {
    it('appends key-value outputs to the configured file', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-audit-output-'));
      const outputFile = path.join(tempDir, 'github-output.txt');

      appendOutput(outputFile, 'critical', 2);
      appendOutput(outputFile, 'high', 1);

      expect(fs.readFileSync(outputFile, 'utf8')).toBe('critical=2\nhigh=1\n');
    });
  });

  describe('parseSecurityAuditReport', () => {
    it('returns vulnerability counts from a valid npm audit report', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-audit-report-'));
      const reportFile = path.join(tempDir, 'npm-audit.json');

      fs.writeFileSync(reportFile, JSON.stringify({
        metadata: {
          vulnerabilities: {
            critical: 3,
            high: 2,
            low: 5,
            moderate: 4,
          },
        },
      }));

      expect(parseSecurityAuditReport(reportFile)).toEqual({
        critical: 3,
        high: 2,
        low: 5,
        moderate: 4,
      });
    });

    it('falls back to zero counts and rewrites the report when parsing fails', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-audit-invalid-'));
      const reportFile = path.join(tempDir, 'npm-audit.json');

      fs.writeFileSync(reportFile, '{not-json');

      expect(parseSecurityAuditReport(reportFile)).toEqual({
        critical: 0,
        high: 0,
        low: 0,
        moderate: 0,
      });

      expect(JSON.parse(fs.readFileSync(reportFile, 'utf8'))).toMatchObject({
        metadata: {
          vulnerabilities: {},
        },
        parseError: expect.any(String),
      });
    });
  });
});
