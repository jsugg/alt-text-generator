#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Rolls a Render web service back to a previously successful deploy through the
 * Render API, rather than force-rewriting the protected production branch.
 *
 * This is the platform-native counterpart to scripts/github/rollback-production.js:
 * the git rollback moves the source ref (and is rejected when a branch ruleset
 * forbids force pushes), whereas this redeploys a known-good image directly on
 * the host — instant, and independent of branch protection.
 *
 * Dry-run by default: prints the chosen target without touching the service.
 */

const fs = require('node:fs');

const RENDER_API_BASE = process.env.RENDER_API_BASE || 'https://api.render.com/v1';

// A deploy that has served traffic is either currently `live` or `deactivated`
// (previously live, later superseded). Those are the only safe rollback targets.
const ROLLBACK_ELIGIBLE_STATUSES = new Set(['live', 'deactivated']);

const POLL_INTERVAL_MS = Number(process.env.RENDER_ROLLBACK_POLL_INTERVAL_MS) || 10_000;
const POLL_TIMEOUT_MS = Number(process.env.RENDER_ROLLBACK_TIMEOUT_MS) || 600_000;
const TERMINAL_SUCCESS_STATUSES = new Set(['live']);
const TERMINAL_FAILURE_STATUSES = new Set([
  'build_failed',
  'update_failed',
  'canceled',
  'pre_deploy_failed',
]);

/**
 * @typedef {object} RollbackArgs
 * @property {string} serviceId
 * @property {string|null} toDeployId
 * @property {string} reason
 * @property {boolean} dryRun
 * @property {string|null} outputFile
 * @property {string|null} summaryFile
 */

/**
 * @typedef {object} RenderDeploy
 * @property {string} id
 * @property {string} status
 * @property {{ id?: string, message?: string }} [commit]
 * @property {string} [finishedAt]
 * @property {string} [createdAt]
 */

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv
 * @returns {RollbackArgs}
 */
function parseArgs(argv) {
  /** @type {Partial<RollbackArgs>} */
  const args = {
    dryRun: true,
    outputFile: null,
    summaryFile: null,
    toDeployId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    index += 1;

    if (value === undefined) {
      throw new Error(`Missing value for --${key}`);
    }

    switch (key) {
      case 'service-id':
        args.serviceId = value;
        break;
      case 'to-deploy-id':
        args.toDeployId = value;
        break;
      case 'reason':
        args.reason = value;
        break;
      case 'dry-run':
        if (value !== 'true' && value !== 'false') {
          throw new Error('--dry-run must be "true" or "false"');
        }

        args.dryRun = value === 'true';
        break;
      case 'output-file':
        args.outputFile = value;
        break;
      case 'summary-file':
        args.summaryFile = value;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.serviceId || !args.reason) {
    throw new Error('--service-id and --reason are required');
  }

  return /** @type {RollbackArgs} */ (args);
}

/**
 * Chooses the deploy to roll back to. When a target is supplied it must be an
 * eligible deploy; otherwise the most recent successful deploy that is not the
 * current one is selected.
 *
 * @param {RenderDeploy[]} deploys - deploys newest-first, as Render returns them
 * @param {string|null} requestedDeployId
 * @returns {{ target: RenderDeploy, currentDeployId: string|null }}
 */
function selectRollbackDeploy(deploys, requestedDeployId) {
  if (!Array.isArray(deploys) || deploys.length === 0) {
    throw new Error('Render returned no deploys for this service.');
  }

  const currentDeployId = deploys[0]?.id ?? null;

  if (requestedDeployId) {
    const requested = deploys.find((deploy) => deploy.id === requestedDeployId);

    if (!requested) {
      throw new Error(
        `Deploy ${requestedDeployId} was not found in this service's recent history.`,
      );
    }

    if (!ROLLBACK_ELIGIBLE_STATUSES.has(requested.status)) {
      throw new Error(
        `Deploy ${requestedDeployId} has status "${requested.status}"; `
        + 'only a deploy that has served traffic (live/deactivated) can be a rollback target.',
      );
    }

    return { target: requested, currentDeployId };
  }

  const fallback = deploys.find(
    (deploy) => deploy.id !== currentDeployId
      && ROLLBACK_ELIGIBLE_STATUSES.has(deploy.status),
  );

  if (!fallback) {
    throw new Error(
      'No earlier successful deploy is available to roll back to. '
      + 'Pass --to-deploy-id explicitly.',
    );
  }

  return { target: fallback, currentDeployId };
}

/**
 * @param {typeof fetch} fetchFn
 * @param {string} apiKey
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [init]
 * @returns {Promise<any>}
 */
async function renderRequest(fetchFn, apiKey, path, { method = 'GET', body } = {}) {
  const response = await fetchFn(`${RENDER_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Render API ${method} ${path} failed: ${response.status} ${response.statusText} ${text}`.trim(),
    );
  }

  return text ? JSON.parse(text) : {};
}

/**
 * Lists a service's recent deploys, newest-first.
 *
 * @param {typeof fetch} fetchFn
 * @param {string} apiKey
 * @param {string} serviceId
 * @param {number} [limit]
 * @returns {Promise<RenderDeploy[]>}
 */
async function listDeploys(fetchFn, apiKey, serviceId, limit = 20) {
  const payload = await renderRequest(
    fetchFn,
    apiKey,
    `/services/${serviceId}/deploys?limit=${limit}`,
  );

  // Render wraps each item as { deploy, cursor }.
  return payload.map((/** @type {{ deploy: RenderDeploy }} */ item) => item.deploy);
}

/**
 * @param {string|null} outputFile
 * @param {string} key
 * @param {string|number|boolean} value
 */
function appendOutput(outputFile, key, value) {
  if (!outputFile) {
    return;
  }

  fs.appendFileSync(outputFile, `${key}=${value}\n`, 'utf8');
}

/**
 * @param {string|null} summaryFile
 * @param {string[]} lines
 */
function appendSummary(summaryFile, lines) {
  if (!summaryFile) {
    return;
  }

  fs.appendFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Polls the rollback deploy until it reaches a terminal state.
 *
 * @param {{
 *   fetchFn: typeof fetch,
 *   apiKey: string,
 *   serviceId: string,
 *   deployId: string,
 *   nowFn?: () => number,
 *   sleepFn?: (ms: number) => Promise<void>,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<RenderDeploy>}
 */
async function waitForDeploy({
  fetchFn,
  apiKey,
  serviceId,
  deployId,
  nowFn = Date.now,
  sleepFn = delay,
  log = console.log,
}) {
  const deadline = nowFn() + POLL_TIMEOUT_MS;

  for (;;) {
    const deploy = /** @type {RenderDeploy} */ (
      await renderRequest(fetchFn, apiKey, `/services/${serviceId}/deploys/${deployId}`)
    );

    if (TERMINAL_SUCCESS_STATUSES.has(deploy.status)) {
      return deploy;
    }

    if (TERMINAL_FAILURE_STATUSES.has(deploy.status)) {
      throw new Error(`Rollback deploy ${deployId} ended in status "${deploy.status}".`);
    }

    if (nowFn() >= deadline) {
      throw new Error(
        `Timed out waiting for rollback deploy ${deployId} to go live `
        + `(last status "${deploy.status}").`,
      );
    }

    log(`Rollback deploy ${deployId} status "${deploy.status}"; waiting...`);
    await sleepFn(POLL_INTERVAL_MS);
  }
}

/**
 * Executes the rollback.
 *
 * @param {RollbackArgs} options
 * @param {{ fetchFn?: typeof fetch, apiKey?: string, log?: (message: string) => void }} [deps]
 * @returns {Promise<void>}
 */
async function rollbackRenderService(options, deps = {}) {
  const fetchFn = deps.fetchFn ?? fetch;
  const apiKey = deps.apiKey ?? process.env.RENDER_API_KEY;
  const log = deps.log ?? console.log;

  if (!apiKey) {
    throw new Error('RENDER_API_KEY is not set.');
  }

  const deploys = await listDeploys(fetchFn, apiKey, options.serviceId);
  const { target, currentDeployId } = selectRollbackDeploy(deploys, options.toDeployId);

  const summaryHeader = [
    '## Render-native Rollback',
    '',
    `- Service: ${options.serviceId}`,
    `- Current deploy: ${currentDeployId ?? 'unknown'}`,
    `- Rollback target: ${target.id} (${target.status}, commit ${target.commit?.id ?? 'n/a'})`,
    `- Reason: ${options.reason}`,
    `- Dry run: ${options.dryRun}`,
  ];

  appendOutput(options.outputFile, 'current_deploy_id', currentDeployId ?? '');
  appendOutput(options.outputFile, 'rollback_target_deploy_id', target.id);

  if (target.id === currentDeployId) {
    appendOutput(options.outputFile, 'rolled_back', false);
    appendSummary(options.summaryFile, summaryHeader.concat([
      '- Target is already the current deploy; nothing to roll back.',
    ]));
    log(`Service ${options.serviceId} already runs ${target.id}; nothing to roll back.`);
    return;
  }

  if (options.dryRun) {
    appendOutput(options.outputFile, 'rolled_back', false);
    appendSummary(options.summaryFile, summaryHeader.concat([
      '- DRY RUN: no rollback was triggered. Re-run with dry_run=false to execute.',
    ]));
    log(`DRY RUN: would roll ${options.serviceId} back to deploy ${target.id}.`);
    return;
  }

  const created = /** @type {RenderDeploy} */ (
    await renderRequest(fetchFn, apiKey, `/services/${options.serviceId}/rollback`, {
      method: 'POST',
      body: { deployId: target.id },
    })
  );

  log(`Triggered rollback deploy ${created.id} → target ${target.id}.`);

  const settled = await waitForDeploy({
    fetchFn,
    apiKey,
    serviceId: options.serviceId,
    deployId: created.id,
    log,
  });

  appendOutput(options.outputFile, 'rolled_back', true);
  appendOutput(options.outputFile, 'rollback_deploy_id', settled.id);
  appendSummary(options.summaryFile, summaryHeader.concat([
    `- Rollback deploy: ${settled.id} (${settled.status})`,
    `- Service now serves the image from deploy ${target.id}.`,
  ]));
  log(`Rollback complete: ${options.serviceId} now serves deploy ${target.id} (via ${settled.id}).`);
}

/**
 * Main entry point.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  await rollbackRenderService(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  selectRollbackDeploy,
  listDeploys,
  waitForDeploy,
  rollbackRenderService,
};
