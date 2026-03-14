#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string[]} argv
 * @returns {{ githubOutput: string }}
 */
function parseArgs(argv) {
  let githubOutput = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--github-output') {
      githubOutput = argv[index + 1] || null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!githubOutput) {
    throw new Error('Missing required argument: --github-output <path>');
  }

  return {
    githubOutput,
  };
}

/**
 * @param {string} eventPath
 * @returns {Record<string, unknown>}
 */
function readEventPayload(eventPath) {
  const resolvedEventPath = path.resolve(process.cwd(), eventPath);
  return JSON.parse(fs.readFileSync(resolvedEventPath, 'utf8'));
}

/**
 * @param {{
 *   dispatchRunId?: string,
 *   eventName?: string,
 *   eventPayload?: Record<string, unknown>,
 * }} options
 * @returns {{
 *   headSha: string,
 *   runId: string,
 *   sourceEvent: string,
 *   workflowConclusion: string,
 * }}
 */
function resolveSourceRun({
  dispatchRunId = '',
  eventName = process.env.GITHUB_EVENT_NAME || '',
  eventPayload = readEventPayload(process.env.GITHUB_EVENT_PATH || ''),
} = {}) {
  const workflowRun = /** @type {{ conclusion?: string, head_sha?: string, id?: number }} */ (
    eventPayload.workflow_run || {}
  );
  const resolvedDispatchRunId = dispatchRunId.trim();
  const runId = eventName === 'workflow_dispatch'
    ? resolvedDispatchRunId
    : String(workflowRun.id || '').trim();

  if (!runId) {
    throw new Error('Unable to resolve the source CI workflow run ID');
  }

  return {
    headSha: String(workflowRun.head_sha || '').trim(),
    runId,
    sourceEvent: eventName,
    workflowConclusion: String(workflowRun.conclusion || '').trim(),
  };
}

/**
 * @param {{
 *   githubOutput: string,
 *   sourceRun: {
 *     headSha: string,
 *     runId: string,
 *     sourceEvent: string,
 *     workflowConclusion: string,
 *   },
 * }} options
 * @returns {void}
 */
function writeGitHubOutputs({
  githubOutput,
  sourceRun,
}) {
  fs.appendFileSync(githubOutput, `run_id=${sourceRun.runId}\n`);
  fs.appendFileSync(githubOutput, `source_event=${sourceRun.sourceEvent}\n`);
  fs.appendFileSync(githubOutput, `workflow_conclusion=${sourceRun.workflowConclusion}\n`);
  fs.appendFileSync(githubOutput, `head_sha=${sourceRun.headSha}\n`);
}

if (require.main === module) {
  const { githubOutput } = parseArgs(process.argv.slice(2));
  const sourceRun = resolveSourceRun({
    dispatchRunId: process.env.DISPATCH_RUN_ID || '',
  });

  writeGitHubOutputs({
    githubOutput,
    sourceRun,
  });
}

module.exports = {
  parseArgs,
  readEventPayload,
  resolveSourceRun,
  writeGitHubOutputs,
};
