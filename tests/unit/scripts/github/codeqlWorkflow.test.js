const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

describe('Unit | Scripts | GitHub | CodeQL Workflow', () => {
  const workflow = loadWorkflow('codeql.yml');
  const analyzeJob = getJob(workflow, 'analyze');

  it('keeps least-privilege permissions with security-events write only', () => {
    assertDeepEqualInvariant(
      'CodeQL workflow grants only actions/contents read plus security-events write',
      workflow.permissions,
      {
        actions: 'read',
        contents: 'read',
        'security-events': 'write',
      },
    );
  });

  it('analyzes with the security-extended query suite', () => {
    const initStep = findStepByName(analyzeJob, 'analyze', 'Initialize CodeQL');

    assertDeepEqualInvariant(
      'CodeQL init pins JavaScript analysis to the security-extended suite',
      initStep.with,
      {
        languages: 'javascript',
        queries: 'security-extended',
      },
    );
  });

  it('does not run an autobuild step for the interpreted JavaScript codebase', () => {
    const autobuildSteps = analyzeJob.steps.filter((step) => (
      (typeof step.uses === 'string' && step.uses.includes('codeql-action/autobuild'))
      || step.name === 'Autobuild'
    ));

    assertDeepEqualInvariant(
      'CodeQL analyze job must not reintroduce the JavaScript autobuild step',
      autobuildSteps,
      [],
    );
  });

  it('keeps the analyze job on the stable required check name with a timeout', () => {
    assertEqualInvariant(
      'CodeQL publishes the stable required check name',
      analyzeJob.name,
      'codeql',
    );
    assertEqualInvariant(
      'CodeQL analyze job declares a timeout',
      analyzeJob['timeout-minutes'],
      30,
    );
  });
});
