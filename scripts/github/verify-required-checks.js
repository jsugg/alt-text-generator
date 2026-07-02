#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Verifies the required status-check policy (config/github/required-checks.json)
 * against workflow job display names and, with --live, against live GitHub
 * branch protection and the production repository ruleset.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_POLICY_PATH = path.join(REPO_ROOT, 'config', 'github', 'required-checks.json');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const PROMOTE_WORKFLOW_FILE = 'promote-to-production.yml';
const MATRIX_TOKEN_PATTERN = /\$\{\{\s*matrix\.([a-zA-Z0-9_-]+)\s*\}\}/gu;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv
 * @returns {{ live: boolean, policyPath: string, repo: string }}
 */
function parseArgs(argv) {
  const args = {
    live: false,
    policyPath: DEFAULT_POLICY_PATH,
    repo: process.env.GITHUB_REPOSITORY || 'jsugg/alt-text-generator',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--live') {
      args.live = true;
    } else if (token === '--policy' || token === '--repo') {
      const value = argv[index + 1];
      index += 1;

      if (value === undefined) {
        throw new Error(`Missing value for ${token}`);
      }

      if (token === '--policy') {
        args.policyPath = path.resolve(value);
      } else {
        args.repo = value;
      }
    } else {
      throw new Error(`Unsupported argument: ${token}`);
    }
  }

  return args;
}

/**
 * Loads and shape-checks the required-check policy file.
 *
 * @param {string} [policyPath]
 * @returns {{
 *   mainBranchProtection: { branch: string, contexts: string[] },
 *   productionRuleset: {
 *     id: number,
 *     contexts: string[],
 *     bypassActors: { actor_id: number, actor_type: string, bypass_mode: string }[],
 *   },
 *   retiredContextPatterns: string[],
 * }}
 */
function loadPolicy(policyPath = DEFAULT_POLICY_PATH) {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

  if (
    !isRecord(policy)
    || !isRecord(policy.mainBranchProtection)
    || !Array.isArray(policy.mainBranchProtection.contexts)
    || !isRecord(policy.productionRuleset)
    || !Array.isArray(policy.productionRuleset.contexts)
    || !Array.isArray(policy.retiredContextPatterns)
  ) {
    throw new Error(`Malformed required-check policy: ${policyPath}`);
  }

  return policy;
}

/**
 * Builds every combination of matrix axis values.
 *
 * @param {{ key: string, values: unknown[] }[]} axes
 * @returns {{ key: string, value: unknown }[][]}
 */
function cartesianProduct(axes) {
  return axes.reduce((combinations, axis) => (
    combinations.flatMap((combination) => axis.values.map((value) => (
      combination.concat([{ key: axis.key, value }])
    )))
  ), [[]]);
}

/**
 * Resolves the check names a job publishes, expanding matrix name templates.
 *
 * @param {string} jobId
 * @param {Record<string, any>} job
 * @returns {{ names: string[], failures: string[] }}
 */
function expandJobCheckNames(jobId, job) {
  const template = typeof job.name === 'string' ? job.name : jobId;

  if (!template.includes('${{')) {
    return { names: [template], failures: [] };
  }

  const matrix = isRecord(job.strategy) && isRecord(job.strategy.matrix)
    ? job.strategy.matrix
    : null;

  if (!matrix) {
    return {
      names: [],
      failures: [`job "${jobId}" uses an expression in its name without a matrix to resolve it`],
    };
  }

  const axes = Object.entries(matrix)
    .filter(([key, values]) => key !== 'include' && key !== 'exclude' && Array.isArray(values))
    .map(([key, values]) => ({ key, values }));
  const names = cartesianProduct(axes).map((combination) => {
    const substitutions = new Map(combination.map(({ key, value }) => [key, String(value)]));

    return template.replace(MATRIX_TOKEN_PATTERN, (token, key) => (
      substitutions.has(key) ? substitutions.get(key) : token
    ));
  });
  const unresolved = names.filter((name) => name.includes('${{'));

  if (unresolved.length > 0) {
    return {
      names: [],
      failures: [
        `job "${jobId}" name "${template}" contains expressions the verifier cannot resolve: `
        + unresolved.join(', '),
      ],
    };
  }

  return { names, failures: [] };
}

/**
 * @param {unknown} triggers
 * @returns {string[]}
 */
function normalizeTriggerNames(triggers) {
  if (typeof triggers === 'string') {
    return [triggers];
  }

  if (Array.isArray(triggers)) {
    return triggers.filter((trigger) => typeof trigger === 'string');
  }

  if (isRecord(triggers)) {
    return Object.keys(triggers);
  }

  return [];
}

/**
 * Collects the check names published by branch-gating workflows (any workflow
 * triggered by push or pull_request), keyed by check name with their sources.
 *
 * @param {string} [workflowsDir]
 * @returns {{ checkNames: Map<string, string[]>, failures: string[] }}
 */
function collectEmittedCheckNames(workflowsDir = WORKFLOWS_DIR) {
  const checkNames = new Map();
  const failures = [];

  fs.readdirSync(workflowsDir)
    .filter((fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
    .sort((left, right) => left.localeCompare(right))
    .forEach((fileName) => {
      const workflow = yaml.load(fs.readFileSync(path.join(workflowsDir, fileName), 'utf8'));

      if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
        return;
      }

      const triggers = normalizeTriggerNames(workflow.on);

      if (!triggers.includes('push') && !triggers.includes('pull_request')) {
        return;
      }

      Object.entries(workflow.jobs).forEach(([jobId, job]) => {
        if (!isRecord(job)) {
          return;
        }

        const expansion = expandJobCheckNames(jobId, job);

        failures.push(...expansion.failures.map((failure) => `${fileName}: ${failure}`));
        expansion.names.forEach((name) => {
          const sources = checkNames.get(name) || [];

          sources.push(`${fileName}#${jobId}`);
          checkNames.set(name, sources);
        });
      });
    });

  return { checkNames, failures };
}

/**
 * @param {string[]} values
 * @returns {string[]} values that appear more than once
 */
function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();

  values.forEach((value) => {
    if (seen.has(value)) {
      duplicates.add(value);
    }

    seen.add(value);
  });

  return [...duplicates];
}

/**
 * Verifies the policy against workflow-emitted check names.
 *
 * @param {ReturnType<typeof loadPolicy>} policy
 * @param {ReturnType<typeof collectEmittedCheckNames>} collected
 * @returns {string[]} failure descriptions; empty when the policy holds
 */
function verifyOfflinePolicy(policy, collected) {
  const failures = [...collected.failures];
  const retiredPatterns = policy.retiredContextPatterns.map((pattern) => new RegExp(pattern, 'u'));
  const mainContexts = policy.mainBranchProtection.contexts;
  const productionContexts = policy.productionRuleset.contexts;

  collected.checkNames.forEach((sources, name) => {
    if (sources.length > 1) {
      failures.push(
        `check name "${name}" is published by multiple jobs (${sources.join(', ')}); `
        + 'required-check contexts must be unambiguous',
      );
    }
  });

  [
    { contexts: mainContexts, label: 'mainBranchProtection' },
    { contexts: productionContexts, label: 'productionRuleset' },
  ].forEach(({ contexts, label }) => {
    findDuplicates(contexts).forEach((context) => {
      failures.push(`${label} lists duplicate context "${context}"`);
    });
    contexts.forEach((context) => {
      if (!collected.checkNames.has(context)) {
        failures.push(
          `${label} context "${context}" is not published by any push/pull_request workflow job`,
        );
      }

      retiredPatterns.forEach((pattern) => {
        if (pattern.test(context)) {
          failures.push(`${label} context "${context}" matches retired pattern ${pattern}`);
        }
      });
    });
  });

  const mainContextSet = new Set(mainContexts);

  productionContexts.forEach((context) => {
    if (!mainContextSet.has(context)) {
      failures.push(
        `productionRuleset context "${context}" is not part of the main branch policy; `
        + 'the release ruleset must not require checks main does not gate on',
      );
    }
  });

  return failures;
}

/**
 * Extracts the hardcoded --required-checks list from the promotion workflow.
 *
 * @param {string} [workflowsDir]
 * @returns {string[]|null} the parsed list, or null when the flag is absent
 */
function parsePromotionRequiredChecks(workflowsDir = WORKFLOWS_DIR) {
  const workflow = yaml.load(
    fs.readFileSync(path.join(workflowsDir, PROMOTE_WORKFLOW_FILE), 'utf8'),
  );

  if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
    throw new Error(`Malformed workflow: ${PROMOTE_WORKFLOW_FILE}`);
  }

  const runCommands = Object.values(workflow.jobs).flatMap((job) => (
    isRecord(job) && Array.isArray(job.steps)
      ? job.steps.filter((step) => isRecord(step) && typeof step.run === 'string')
      : []
  )).map((step) => step.run);
  const promotionCommand = runCommands.find((run) => run.includes('promote-to-production.js'));

  if (!promotionCommand) {
    throw new Error(`${PROMOTE_WORKFLOW_FILE} does not invoke promote-to-production.js`);
  }

  const match = promotionCommand.match(/--required-checks\s+"([^"]*)"/u);

  if (!match) {
    return null;
  }

  return match[1].split(',').map((value) => value.trim()).filter(Boolean);
}

/**
 * Compares two context lists as sets and reports both diff directions.
 *
 * @param {string} label
 * @param {string[]} expected
 * @param {string[]} actual
 * @returns {string[]}
 */
function formatSetDiff(label, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = actual.filter((value, index) => (
    !expectedSet.has(value) && actual.indexOf(value) === index
  ));
  const failures = [];

  if (missing.length > 0) {
    failures.push(`${label}: missing expected contexts: ${missing.join(', ')}`);
  }

  if (unexpected.length > 0) {
    failures.push(`${label}: unexpected contexts: ${unexpected.join(', ')}`);
  }

  return failures;
}

/**
 * Verifies the promotion workflow stays aligned with the policy while it still
 * hardcodes required checks. A null list (flag removed) is aligned by design:
 * the promotion script then derives checks from live main branch protection.
 *
 * @param {ReturnType<typeof loadPolicy>} policy
 * @param {string[]|null} promotionChecks
 * @returns {string[]}
 */
function verifyPromotionAlignment(policy, promotionChecks) {
  if (promotionChecks === null) {
    return [];
  }

  return formatSetDiff(
    'promotion workflow --required-checks',
    policy.mainBranchProtection.contexts,
    promotionChecks,
  );
}

/**
 * Runs a gh CLI command and returns trimmed stdout.
 *
 * @param {string[]} args
 * @returns {string}
 */
function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * @param {string[]} args
 * @returns {any}
 */
function runGhJson(args) {
  return JSON.parse(runGh(args));
}

/**
 * Verifies live main branch protection against the policy.
 *
 * @param {ReturnType<typeof loadPolicy>} policy
 * @param {string} repo
 * @returns {string[]}
 */
function verifyLiveMainProtection(policy, repo) {
  const { branch } = policy.mainBranchProtection;
  const payload = runGhJson(['api', `repos/${repo}/branches/${branch}/protection`]);
  const liveContexts = payload.required_status_checks.contexts;

  return formatSetDiff(
    `live ${branch} branch protection`,
    policy.mainBranchProtection.contexts,
    liveContexts,
  ).concat(findDuplicates(liveContexts).map((context) => (
    `live ${branch} branch protection lists duplicate context "${context}"`
  )));
}

/**
 * Verifies the live production ruleset (contexts and bypass actors).
 *
 * @param {ReturnType<typeof loadPolicy>} policy
 * @param {string} repo
 * @returns {string[]}
 */
function verifyLiveProductionRuleset(policy, repo) {
  const ruleset = runGhJson(['api', `repos/${repo}/rulesets/${policy.productionRuleset.id}`]);
  const checksRule = (ruleset.rules || []).find((rule) => rule.type === 'required_status_checks');

  if (!checksRule) {
    return [`live ruleset ${policy.productionRuleset.id} has no required_status_checks rule`];
  }

  const liveContexts = checksRule.parameters.required_status_checks.map((entry) => entry.context);
  const failures = formatSetDiff(
    `live production ruleset ${policy.productionRuleset.id}`,
    policy.productionRuleset.contexts,
    liveContexts,
  );

  findDuplicates(liveContexts).forEach((context) => {
    failures.push(
      `live production ruleset ${policy.productionRuleset.id} lists duplicate context "${context}"`,
    );
  });

  const normalizeActors = (actors) => actors
    .map(({ actor_id: actorId, actor_type: actorType, bypass_mode: bypassMode }) => (
      `${actorType}/${actorId} (${bypassMode})`
    ))
    .sort((left, right) => left.localeCompare(right));
  const expectedActors = normalizeActors(policy.productionRuleset.bypassActors || []);
  const liveActors = normalizeActors(ruleset.bypass_actors || []);

  return failures.concat(formatSetDiff(
    `live production ruleset ${policy.productionRuleset.id} bypass actors`,
    expectedActors,
    liveActors,
  ));
}

/**
 * Main entry point.
 */
function main() {
  const options = parseArgs(process.argv.slice(2));
  const policy = loadPolicy(options.policyPath);
  const failures = verifyOfflinePolicy(policy, collectEmittedCheckNames())
    .concat(verifyPromotionAlignment(policy, parsePromotionRequiredChecks()));

  console.log(`Offline policy verification: ${failures.length === 0 ? 'OK' : 'FAILED'}`);

  if (options.live) {
    const liveFailures = verifyLiveMainProtection(policy, options.repo)
      .concat(verifyLiveProductionRuleset(policy, options.repo));

    console.log(`Live policy verification: ${liveFailures.length === 0 ? 'OK' : 'FAILED'}`);
    failures.push(...liveFailures);
  }

  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectEmittedCheckNames,
  expandJobCheckNames,
  findDuplicates,
  formatSetDiff,
  loadPolicy,
  parseArgs,
  parsePromotionRequiredChecks,
  verifyLiveMainProtection,
  verifyLiveProductionRuleset,
  verifyOfflinePolicy,
  verifyPromotionAlignment,
};
