const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  assertExpressionContainsInvariant,
  assertStepUsesAction,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

const AUDIT_SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../../scripts/github/run-security-audit.sh',
);
const AUDIT_PARSER_PATH = path.resolve(
  __dirname,
  '../../../../scripts/github/parse-security-audit-report.js',
);

/**
 * @param {object} report
 * @param {number} npmStatus
 * @param {{ auditScope?: string }} [options]
 */
const runAuditScript = (report, npmStatus, { auditScope } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-audit-'));
  const scriptsDir = path.join(root, 'scripts', 'github');
  const binDir = path.join(root, 'bin');
  const reportFixture = path.join(root, 'audit-fixture.json');
  const outputFile = path.join(root, 'github-output.txt');
  const argsFile = path.join(root, 'npm-args.txt');

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(binDir);
  fs.copyFileSync(AUDIT_SCRIPT_PATH, path.join(scriptsDir, 'run-security-audit.sh'));
  fs.copyFileSync(AUDIT_PARSER_PATH, path.join(scriptsDir, 'parse-security-audit-report.js'));
  fs.writeFileSync(reportFixture, JSON.stringify(report), 'utf8');
  fs.writeFileSync(
    path.join(binDir, 'npm'),
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "${FAKE_NPM_ARGS}"\ncat "${FAKE_AUDIT_REPORT}"\nexit "${FAKE_NPM_STATUS}"\n',
    { encoding: 'utf8', mode: 0o755 },
  );

  try {
    const result = spawnSync('bash', ['scripts/github/run-security-audit.sh'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        AUDIT_MAX_ATTEMPTS: '1',
        ...(auditScope ? { AUDIT_SCOPE: auditScope } : {}),
        FAKE_NPM_ARGS: argsFile,
        FAKE_AUDIT_REPORT: reportFixture,
        FAKE_NPM_STATUS: String(npmStatus),
        GITHUB_OUTPUT: outputFile,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });
    const outputs = Object.fromEntries(
      fs.readFileSync(outputFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );

    return {
      args: fs.readFileSync(argsFile, 'utf8').trim(),
      outputs,
      result,
    };
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
};

describe('Unit | Scripts | GitHub | Security Audit Workflow', () => {
  const workflow = loadWorkflow('security-audit.yml');
  const job = getJob(workflow, 'npm-audit');
  const ciDependencyAudit = getJob(loadWorkflow('ci.yml'), 'dependency-audit');

  it('runs weekly and on manual dispatch only', () => {
    assertDeepEqualInvariant(
      'Security audit triggers on schedule and workflow_dispatch only',
      workflow.on,
      {
        workflow_dispatch: null,
        schedule: [{ cron: '41 7 * * 1' }],
      },
    );
  });

  it('keeps least-privilege read-only permissions and a job timeout', () => {
    assertDeepEqualInvariant(
      'Security audit workflow keeps contents read-only permissions',
      workflow.permissions,
      { contents: 'read' },
    );
    assertEqualInvariant(
      'Security audit job declares a timeout',
      job['timeout-minutes'],
      15,
    );
  });

  it('audits production dependencies through the repository script', () => {
    const auditStep = findStepByName(job, 'npm-audit', 'Run production dependency audit');

    assertEqualInvariant(
      'Security audit runs the repository audit script',
      auditStep.run,
      'bash scripts/github/run-security-audit.sh',
    );
    assertEqualInvariant(
      'Security audit step exposes outputs under the audit id',
      auditStep.id,
      'audit',
    );
  });

  it('runs the same fail-closed audit for npm dependency changes in pull requests', () => {
    const auditStep = findStepByName(
      ciDependencyAudit,
      'dependency-audit',
      'Run full dependency audit',
    );
    const unavailableStep = findStepByName(
      ciDependencyAudit,
      'dependency-audit',
      'Fail when the registry audit is unavailable',
    );

    assertExpressionContainsInvariant(
      'Dependency audit only runs when npm dependency inputs change',
      ciDependencyAudit.if,
      "needs.changes.outputs.dependencies_changed == 'true'",
    );
    assertEqualInvariant(
      'Pull request dependency audit reuses the hardened repository script',
      auditStep.run,
      'bash scripts/github/run-security-audit.sh',
    );
    assertDeepEqualInvariant(
      'Pull request dependency audit includes development dependencies',
      auditStep.env,
      { AUDIT_SCOPE: 'full' },
    );
    assertExpressionContainsInvariant(
      'Pull request dependency audit fails closed when no report is available',
      unavailableStep.if,
      "steps.audit.outputs.available != 'true'",
    );
  });

  it('retries incomplete registry responses with a bounded attempt count', () => {
    const script = fs.readFileSync(AUDIT_SCRIPT_PATH, 'utf8');

    expect(script).toContain('AUDIT_MAX_ATTEMPTS:-3');
    expect(script).toContain('report_is_complete');
    expect(script).toContain('attempt <= max_attempts');
    expect(script).toContain("printf 'available=%s");
  });

  it('defaults to production scope and supports explicit full-tree audits', () => {
    const report = {
      metadata: {
        vulnerabilities: {
          critical: 0, high: 0, moderate: 0, low: 0, total: 0,
        },
      },
    };
    const production = runAuditScript(report, 0);
    const full = runAuditScript(report, 0, { auditScope: 'full' });

    expect(production.args).toContain('--omit=dev');
    expect(full.args).not.toContain('--omit=dev');
    expect(full.args).toContain('--audit-level=high --json');
  });

  it('accepts a complete findings report independently of the npm exit status', () => {
    const { outputs, result } = runAuditScript({
      metadata: {
        vulnerabilities: {
          critical: 0, high: 1, moderate: 0, low: 0, total: 1,
        },
      },
    }, 1);

    expect(result.status).toBe(0);
    expect(outputs).toMatchObject({
      available: 'true',
      critical: '0',
      high: '1',
      status: '1',
    });
  });

  it('marks a registry error payload unavailable instead of treating it as zero findings', () => {
    const { outputs, result } = runAuditScript({ error: { code: 'EAI_AGAIN' } }, 1);

    expect(result.status).toBe(0);
    expect(outputs).toMatchObject({
      available: 'false',
      critical: '0',
      high: '0',
      status: '1',
    });
  });

  it('verifies registry signatures as an advisory, never-blocking step', () => {
    const signaturesStep = findStepByName(job, 'npm-audit', 'Verify registry signatures (advisory)');

    assertStringContainsInvariant(
      'Registry signature verification runs npm audit signatures',
      signaturesStep.run,
      'npm audit signatures',
    );
    assertStringContainsInvariant(
      'Registry signature verification downgrades failures to a warning',
      signaturesStep.run,
      '|| echo "::warning::',
    );
  });

  it('uploads audit artifacts with bounded retention even on failure', () => {
    const uploadStep = findStepByName(job, 'npm-audit', 'Upload audit artifacts');

    assertStepUsesAction(
      'Security audit uploads artifacts with actions/upload-artifact',
      uploadStep,
      'actions/upload-artifact',
    );
    assertExpressionContainsInvariant(
      'Security audit uploads artifacts even when the audit fails',
      uploadStep.if,
      'always()',
    );
    assertDeepEqualInvariant(
      'Security audit artifact upload stays scoped with bounded retention',
      uploadStep.with,
      {
        name: 'security-audit-artifacts',
        path: 'reports/security/',
        'if-no-files-found': 'ignore',
        'retention-days': 7,
      },
    );
  });

  it('separates registry failures from high or critical production findings', () => {
    const unavailableStep = findStepByName(
      job,
      'npm-audit',
      'Fail when the registry audit is unavailable',
    );
    const failStep = findStepByName(job, 'npm-audit', 'Fail on high or critical findings');

    assertExpressionContainsInvariant(
      'Registry failure gate rejects incomplete reports',
      unavailableStep.if,
      "steps.audit.outputs.available != 'true'",
    );
    assertExpressionContainsInvariant(
      'Security finding gate requires a complete report',
      failStep.if,
      "steps.audit.outputs.available == 'true'",
    );
    assertExpressionContainsInvariant(
      'Security finding gate keys off high findings',
      failStep.if,
      "steps.audit.outputs.high != '0'",
    );
    assertExpressionContainsInvariant(
      'Security finding gate keys off critical findings',
      failStep.if,
      "steps.audit.outputs.critical != '0'",
    );
    assertStringContainsInvariant(
      'Security audit failure gate exits non-zero',
      failStep.run,
      'exit 1',
    );
  });
});
