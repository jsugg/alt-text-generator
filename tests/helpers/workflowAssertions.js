const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const WORKFLOWS_DIR = path.join(__dirname, '..', '..', '.github', 'workflows');

function invariantMessage(invariant) {
  return `Repository workflow invariant failed: ${invariant}`;
}

function failInvariant(invariant, actual, expected) {
  throw new assert.AssertionError({
    actual,
    expected,
    message: invariantMessage(invariant),
    operator: 'repositoryWorkflowInvariant',
  });
}

function assertConditionInvariant(invariant, condition, actual, expected) {
  if (!condition) {
    failInvariant(invariant, actual, expected);
  }
}

function assertDeepEqualInvariant(invariant, actual, expected) {
  assert.deepStrictEqual(actual, expected, invariantMessage(invariant));
}

function assertEqualInvariant(invariant, actual, expected) {
  assert.strictEqual(actual, expected, invariantMessage(invariant));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecordInvariant(invariant, value) {
  assertConditionInvariant(invariant, isRecord(value), value, 'object map');
  return value;
}

function loadWorkflow(fileName) {
  const workflowPath = path.join(WORKFLOWS_DIR, fileName);
  const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8'));

  assertRecordInvariant(`${fileName} parses to a GitHub Actions workflow object`, workflow);
  assertRecordInvariant(`${fileName} declares GitHub Actions triggers`, workflow.on);
  assertRecordInvariant(`${fileName} declares GitHub Actions jobs`, workflow.jobs);

  return workflow;
}

function getJob(workflow, jobId) {
  const jobs = assertRecordInvariant('workflow declares jobs as a map', workflow.jobs);
  const job = jobs[jobId];

  assertRecordInvariant(`workflow declares the "${jobId}" job`, job);

  return job;
}

function getSteps(job, jobId) {
  assertConditionInvariant(
    `job "${jobId}" declares a steps array`,
    Array.isArray(job.steps),
    job.steps,
    'steps array',
  );

  return job.steps;
}

function findStepByName(job, jobId, stepName) {
  const matches = getSteps(job, jobId).filter((step) => (
    isRecord(step) && step.name === stepName
  ));

  assertEqualInvariant(
    `job "${jobId}" contains exactly one "${stepName}" step`,
    matches.length,
    1,
  );

  return matches[0];
}

function actionNameFromUses(uses) {
  if (typeof uses !== 'string') {
    return null;
  }

  const separatorIndex = uses.indexOf('@');
  return separatorIndex === -1 ? uses : uses.slice(0, separatorIndex);
}

function assertStepUsesAction(invariant, step, expectedActionName) {
  assertEqualInvariant(invariant, actionNameFromUses(step.uses), expectedActionName);
}

function normalizeWorkflowString(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function assertStringContainsInvariant(invariant, value, expectedFragment) {
  assertConditionInvariant(invariant, typeof value === 'string', value, 'string');

  const normalizedExpression = normalizeWorkflowString(value);
  const normalizedFragment = normalizeWorkflowString(expectedFragment);

  assertConditionInvariant(
    invariant,
    normalizedExpression.includes(normalizedFragment),
    normalizedExpression,
    `contains ${normalizedFragment}`,
  );
}

function assertExpressionContainsInvariant(invariant, expression, expectedFragment) {
  assertStringContainsInvariant(invariant, expression, expectedFragment);
}

function collectRunCommands(workflow) {
  const jobs = assertRecordInvariant('workflow declares jobs as a map', workflow.jobs);

  return Object.entries(jobs).flatMap(([jobId, job]) => {
    if (!isRecord(job) || !Array.isArray(job.steps)) {
      return [];
    }

    return job.steps
      .filter((step) => isRecord(step) && typeof step.run === 'string')
      .map((step) => ({
        job: jobId,
        run: normalizeWorkflowString(step.run),
        step: step.name || '<unnamed>',
      }));
  });
}

function assertNoRunCommandContainsInvariant(workflow, forbiddenFragment, invariant) {
  const normalizedFragment = normalizeWorkflowString(forbiddenFragment);
  const matches = collectRunCommands(workflow).filter(({ run }) => (
    run.includes(normalizedFragment)
  ));

  assertDeepEqualInvariant(invariant, matches, []);
}

function collectConditions(workflow) {
  const jobs = assertRecordInvariant('workflow declares jobs as a map', workflow.jobs);

  return Object.entries(jobs).flatMap(([jobId, job]) => {
    if (!isRecord(job)) {
      return [];
    }

    const jobCondition = typeof job.if === 'string'
      ? [{
          condition: normalizeWorkflowString(job.if),
          job: jobId,
          scope: 'job',
        }]
      : [];
    const stepConditions = Array.isArray(job.steps)
      ? job.steps
          .filter((step) => isRecord(step) && typeof step.if === 'string')
          .map((step) => ({
            condition: normalizeWorkflowString(step.if),
            job: jobId,
            scope: `step:${step.name || '<unnamed>'}`,
          }))
      : [];

    return jobCondition.concat(stepConditions);
  });
}

function assertNoConditionContainsInvariant(workflow, forbiddenFragment, invariant) {
  const normalizedFragment = normalizeWorkflowString(forbiddenFragment);
  const matches = collectConditions(workflow).filter(({ condition }) => (
    condition.includes(normalizedFragment)
  ));

  assertDeepEqualInvariant(invariant, matches, []);
}

function collectActionReferences(job, jobId) {
  return getSteps(job, jobId)
    .filter((step) => isRecord(step) && typeof step.uses === 'string')
    .map((step) => ({
      action: actionNameFromUses(step.uses),
      step: step.name || '<unnamed>',
      uses: step.uses,
    }));
}

function assertNoActionReferencesInvariant(job, jobId, forbiddenActionNames, invariant) {
  const forbidden = new Set(forbiddenActionNames);
  const matches = collectActionReferences(job, jobId).filter(({ action }) => forbidden.has(action));

  assertDeepEqualInvariant(invariant, matches, []);
}

function assertEnvContainsInvariant(invariant, env, expectedValues) {
  const envRecord = assertRecordInvariant(`${invariant} step declares an env map`, env);
  const actualValues = Object.fromEntries(
    Object.keys(expectedValues).map((key) => [key, envRecord[key]]),
  );

  assertDeepEqualInvariant(invariant, actualValues, expectedValues);
}

function collectWorkflowEnvKeyReferences(workflow, envKeys) {
  const jobs = assertRecordInvariant('workflow declares jobs as a map', workflow.jobs);
  const watchedEnvKeys = new Set(envKeys);
  const collectEnvKeys = (env, jobId, scope) => (
    isRecord(env)
      ? Object.keys(env)
          .filter((key) => watchedEnvKeys.has(key))
          .map((key) => ({ job: jobId, key, scope }))
      : []
  );

  return Object.entries(jobs).flatMap(([jobId, job]) => {
    if (!isRecord(job)) {
      return [];
    }

    const jobMatches = collectEnvKeys(job.env, jobId, 'job');
    const stepMatches = Array.isArray(job.steps)
      ? job.steps.flatMap((step) => (
          isRecord(step)
            ? collectEnvKeys(step.env, jobId, `step:${step.name || '<unnamed>'}`)
            : []
        ))
      : [];

    return jobMatches.concat(stepMatches);
  });
}

function assertNoEnvKeysInvariant(workflow, envKeys, invariant) {
  assertDeepEqualInvariant(invariant, collectWorkflowEnvKeyReferences(workflow, envKeys), []);
}

module.exports = {
  assertDeepEqualInvariant,
  assertEnvContainsInvariant,
  assertEqualInvariant,
  assertExpressionContainsInvariant,
  assertNoActionReferencesInvariant,
  assertNoConditionContainsInvariant,
  assertNoEnvKeysInvariant,
  assertNoRunCommandContainsInvariant,
  assertStepUsesAction,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
};
