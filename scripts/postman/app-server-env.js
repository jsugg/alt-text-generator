const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const NO_PROVIDER_OVERRIDES_FILE = path.join(
  ROOT,
  'tests',
  'fixtures',
  'provider-overrides.missing.yaml',
);

function buildAppServerEnv({
  httpPort,
  httpsPort,
  replicateApiEndpoint = null,
  replicateApiToken = null,
  azureApiEndpoint = null,
  azureSubscriptionKey = null,
  openaiApiKey = null,
  openaiBaseUrl = null,
  openaiModel = null,
  hfApiKey = null,
  hfBaseUrl = null,
  hfModel = null,
  openrouterApiKey = null,
  openrouterBaseUrl = null,
  openrouterModel = null,
  apiAuthTokens = null,
  scraperRequestTimeoutMs = null,
  pageDescriptionConcurrency = null,
  descriptionJobWaitTimeoutMs = null,
  descriptionJobPollIntervalMs = null,
  replicatePollIntervalMs = null,
}) {
  const env = {
    NODE_ENV: 'development',
    PORT: httpPort,
    TLS_PORT: httpsPort,
    WORKER_COUNT: '1',
    LOG_LEVEL: 'info',
    PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
    SWAGGER_DEV_URL: `https://localhost:${httpsPort}`,
    ACV_LANGUAGE: 'en',
    ACV_MAX_CANDIDATES: '4',
  };

  if (replicateApiToken) {
    env.REPLICATE_API_TOKEN = replicateApiToken;
  }

  if (replicateApiEndpoint) {
    env.REPLICATE_API_ENDPOINT = replicateApiEndpoint;
  }

  if (azureApiEndpoint) {
    env.ACV_API_ENDPOINT = azureApiEndpoint;
  }

  if (azureSubscriptionKey) {
    env.ACV_SUBSCRIPTION_KEY = azureSubscriptionKey;
  }

  if (openaiApiKey) {
    env.OPENAI_API_KEY = openaiApiKey;
  }

  if (openaiBaseUrl) {
    env.OPENAI_BASE_URL = openaiBaseUrl;
  }

  if (openaiModel) {
    env.OPENAI_MODEL = openaiModel;
  }

  if (hfApiKey) {
    env.HF_API_KEY = hfApiKey;
  }

  if (hfBaseUrl) {
    env.HF_BASE_URL = hfBaseUrl;
  }

  if (hfModel) {
    env.HF_MODEL = hfModel;
  }

  if (openrouterApiKey) {
    env.OPENROUTER_API_KEY = openrouterApiKey;
  }

  if (openrouterBaseUrl) {
    env.OPENROUTER_BASE_URL = openrouterBaseUrl;
  }

  if (openrouterModel) {
    env.OPENROUTER_MODEL = openrouterModel;
  }

  if (apiAuthTokens) {
    env.API_AUTH_ENABLED = 'true';
    env.API_AUTH_TOKENS = apiAuthTokens;
  }

  if (scraperRequestTimeoutMs) {
    env.SCRAPER_REQUEST_TIMEOUT_MS = scraperRequestTimeoutMs;
  }

  if (pageDescriptionConcurrency) {
    env.PAGE_DESCRIPTION_CONCURRENCY = pageDescriptionConcurrency;
  }

  if (descriptionJobWaitTimeoutMs) {
    env.DESCRIPTION_JOB_WAIT_TIMEOUT_MS = descriptionJobWaitTimeoutMs;
  }

  if (descriptionJobPollIntervalMs) {
    env.DESCRIPTION_JOB_POLL_INTERVAL_MS = descriptionJobPollIntervalMs;
  }

  if (replicatePollIntervalMs) {
    env.REPLICATE_POLL_INTERVAL_MS = replicatePollIntervalMs;
  }

  return env;
}

module.exports = {
  buildAppServerEnv,
};
