const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

const WORKFLOWS_DIR = path.resolve(__dirname, '..', '..', '..', '..', '.github', 'workflows');
const COMPOSITE_ACTION_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '.github',
  'actions',
  'setup-node-project',
  'action.yml',
);
const FULL_SHA_USES_PATTERN = /^[^@]+@[0-9a-f]{40}$/u;
const HARDENED_JOBS = [
  ['promote-to-production.yml', 'pre-production-provider-validation'],
  ['promote-to-production.yml', 'promote'],
  ['post-deploy-verification.yml', 'smoke'],
  ['security-audit.yml', 'npm-audit'],
  ['dependency-review.yml', 'dependency-review'],
  ['live-provider-validation.yml', 'live-provider'],
  ['rollback-production.yml', 'rollback'],
];

function collectUses(document) {
  const jobs = document.jobs || { composite: document.runs };

  return Object.values(jobs).flatMap((job) => (
    Array.isArray(job.steps)
      ? job.steps.filter((step) => typeof step.uses === 'string').map((step) => step.uses)
      : []
  ));
}

describe('Unit | Scripts | GitHub | Workflow Hardening', () => {
  it('pins every external action to a full-length commit SHA', () => {
    const workflowUses = fs.readdirSync(WORKFLOWS_DIR)
      .filter((fileName) => fileName.endsWith('.yml'))
      .flatMap((fileName) => collectUses(loadWorkflow(fileName)));
    const compositeUses = collectUses(
      yaml.load(fs.readFileSync(COMPOSITE_ACTION_PATH, 'utf8')),
    );
    const unpinned = workflowUses.concat(compositeUses).filter((uses) => (
      !uses.startsWith('./') && !FULL_SHA_USES_PATTERN.test(uses)
    ));

    // jest-native equality: node assert.deepStrictEqual trips on realm
    // differences for the yaml-derived strings under the jest vm context.
    expect(unpinned).toEqual([]);
    expect(workflowUses.length).toBeGreaterThan(50);
  });

  it('blocks on pinned offline zizmor findings in the actionlint job', () => {
    const workflow = loadWorkflow('ci.yml');
    const actionlintJob = getJob(workflow, 'actionlint');
    const zizmorStep = findStepByName(
      actionlintJob,
      'actionlint',
      'Run zizmor workflow audit',
    );

    assertStringContainsInvariant(
      'zizmor installs a pinned version',
      zizmorStep.run,
      'pipx install zizmor==1.28.0',
    );
    assertStringContainsInvariant(
      'zizmor runs deterministically without network access',
      zizmorStep.run,
      'zizmor --offline .github/workflows/',
    );
    assertEqualInvariant(
      'zizmor findings are not converted into warnings',
      zizmorStep.run.includes('||'),
      false,
    );
  });

  it('prevents checkout credential persistence in every workflow job', () => {
    const unsafeCheckouts = fs.readdirSync(WORKFLOWS_DIR)
      .filter((fileName) => fileName.endsWith('.yml'))
      .flatMap((fileName) => Object.entries(loadWorkflow(fileName).jobs || {})
        .flatMap(([jobId, job]) => (job.steps || [])
          .filter((step) => (
            typeof step.uses === 'string'
            && step.uses.startsWith('actions/checkout@')
            && step.with?.['persist-credentials'] !== false
          ))
          .map((step) => `${fileName}#${jobId}:${step.name || 'unnamed'}`)));

    expect(unsafeCheckouts).toEqual([]);
  });

  it('passes workflow expressions through environment variables before shell execution', () => {
    const injectedRunBlocks = fs.readdirSync(WORKFLOWS_DIR)
      .filter((fileName) => fileName.endsWith('.yml'))
      .flatMap((fileName) => Object.entries(loadWorkflow(fileName).jobs || {})
        .flatMap(([jobId, job]) => (job.steps || [])
          .filter((step) => typeof step.run === 'string' && step.run.includes('${{'))
          .map((step) => `${fileName}#${jobId}:${step.name || 'unnamed'}`)));

    expect(injectedRunBlocks).toEqual([]);
  });

  it('scopes write permissions to the jobs that consume them', () => {
    const codeqlWorkflow = loadWorkflow('codeql.yml');
    const promotionWorkflow = loadWorkflow('promote-to-production.yml');

    assertDeepEqualInvariant(
      'CodeQL defaults to read-only repository access',
      codeqlWorkflow.permissions,
      { contents: 'read' },
    );
    assertDeepEqualInvariant(
      'CodeQL grants result upload only to the analysis job',
      getJob(codeqlWorkflow, 'analyze').permissions,
      {
        actions: 'read',
        contents: 'read',
        'security-events': 'write',
      },
    );
    assertDeepEqualInvariant(
      'Production promotion uses its explicit installation token for writes',
      promotionWorkflow.permissions,
      { contents: 'read' },
    );
  });

  it('runs harden-runner in audit mode as the first step of secret-bearing jobs', () => {
    HARDENED_JOBS.forEach(([fileName, jobId]) => {
      const job = getJob(loadWorkflow(fileName), jobId);
      const [firstStep] = job.steps;

      assertEqualInvariant(
        `${fileName}#${jobId} starts with the harden-runner audit step`,
        firstStep.name,
        'Harden runner (audit)',
      );
      assertEqualInvariant(
        `${fileName}#${jobId} pins harden-runner to a full SHA`,
        typeof firstStep.uses === 'string'
        && firstStep.uses.startsWith('step-security/harden-runner@')
        && FULL_SHA_USES_PATTERN.test(firstStep.uses),
        true,
      );
      assertDeepEqualInvariant(
        `${fileName}#${jobId} keeps harden-runner in audit (non-blocking) mode`,
        firstStep.with,
        { 'egress-policy': 'audit' },
      );
    });
  });

  it('keeps harden-runner out of fork-facing CI jobs', () => {
    const ciWorkflow = loadWorkflow('ci.yml');
    const references = Object.entries(ciWorkflow.jobs).flatMap(([jobId, job]) => (
      (job.steps || [])
        .filter((step) => typeof step.uses === 'string' && step.uses.includes('harden-runner'))
        .map(() => jobId)
    ));

    assertDeepEqualInvariant(
      'CI pull_request-facing jobs must not carry harden-runner telemetry',
      references,
      [],
    );
  });
});
