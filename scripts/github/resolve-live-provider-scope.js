#!/usr/bin/env node

const fs = require('node:fs');
const {
  detectAvailableProviders,
  resolveProviderScope,
} = require('../postman/live-provider-scope');

/**
 * Appends a single-line output to a GitHub Actions env file.
 *
 * @param {string|undefined} envFile
 * @param {string} key
 * @param {string} value
 */
function appendGitHubEnv(envFile, key, value) {
  if (!envFile) {
    return;
  }

  fs.appendFileSync(envFile, `${key}=${value}\n`, 'utf8');
}

/**
 * Appends markdown to a GitHub Actions summary file.
 *
 * @param {string|undefined} summaryFile
 * @param {string[]} lines
 */
function appendSummary(summaryFile, lines) {
  if (!summaryFile) {
    return;
  }

  fs.appendFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Resolves the live provider scope from the current environment.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {'azure'|'replicate'|'all'}
 */
function resolveScopeFromEnv(env = process.env) {
  const availableProviders = detectAvailableProviders({
    replicateApiToken: env.REPLICATE_API_TOKEN,
    azureApiEndpoint: env.ACV_API_ENDPOINT,
    azureSubscriptionKey: env.ACV_SUBSCRIPTION_KEY,
  });

  return resolveProviderScope({
    requestedScope: env.INPUT_PROVIDER_SCOPE,
    configuredScope: env.ENV_LIVE_PROVIDER_SCOPE,
    hasAzureProvider: availableProviders.hasAzureProvider,
    hasReplicateProvider: availableProviders.hasReplicateProvider,
  });
}

/**
 * Entry point.
 */
function main() {
  const scope = resolveScopeFromEnv(process.env);
  appendGitHubEnv(process.env.GITHUB_ENV, 'LIVE_PROVIDER_SCOPE', scope);
  appendSummary(process.env.GITHUB_STEP_SUMMARY, [
    '## Live Provider Validation',
    '',
    `- Resolved provider scope: ${scope}`,
  ]);
  process.stdout.write(`${scope}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  appendGitHubEnv,
  appendSummary,
  resolveScopeFromEnv,
};
