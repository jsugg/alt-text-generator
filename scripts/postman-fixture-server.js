#!/usr/bin/env node

/**
 * Deterministic local fixture server for the Postman/Newman harness.
 *
 * It serves:
 * - a health endpoint
 * - a page with duplicate + mixed absolute/relative image references
 * - lightweight PNG assets
 * - provider-validation page/assets
 * - mocked provider endpoints for Azure, Replicate, and OpenAI-compatible APIs
 */

const express = require('express');

const {
  buildProviderValidationPageHtml,
  getProviderValidationAsset,
} = require('../src/providerValidation/fixtures');

const HOST = '127.0.0.1';
const PORT = Number(process.env.POSTMAN_FIXTURE_PORT || 19090);
const BASE_URL = `http://${HOST}:${PORT}`;
const OPENAI_COMPATIBLE_JSON_LIMIT = '1mb';
const REPLICATE_SUCCESS_POLL_COUNT = 6;
const REPLICATE_FAILURE_POLL_COUNT = 8;

const ASSET_A_PNG = getProviderValidationAsset('a.png');
const ASSET_B_PNG = getProviderValidationAsset('b.png');

const ASSET_PROVIDER_FAILURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAl0lEQVR4nO3QMREAIAzAwHrCvwM8FRk/kOH3XObO2Z+NDtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QHvjH+HSo31RkQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Returns a deterministic caption for a given image URL.
 *
 * @param {string} imageUrl
 * @returns {string}
 */
function captionForUrl(imageUrl) {
  if (imageUrl.endsWith('/assets/a.png')) {
    return 'stub caption for asset a';
  }

  if (imageUrl.endsWith('/assets/b.png')) {
    return 'stub caption for asset b';
  }

  return 'stub caption for unknown asset';
}

/**
 * Returns a deterministic caption for a known image payload.
 *
 * @param {Buffer} imageBuffer
 * @returns {string}
 */
function captionForBuffer(imageBuffer) {
  if (Buffer.compare(imageBuffer, ASSET_A_PNG) === 0) {
    return 'stub caption for asset a';
  }

  if (Buffer.compare(imageBuffer, ASSET_B_PNG) === 0) {
    return 'stub caption for asset b';
  }

  return 'stub caption for unknown asset';
}

/**
 * @param {string} providerName
 * @returns {string}
 */
function buildProviderCaption(providerName) {
  return `${providerName} stub caption`;
}

/**
 * @param {string} imageUrl
 * @returns {boolean}
 */
function isProviderFailureAssetUrl(imageUrl) {
  return typeof imageUrl === 'string' && imageUrl.endsWith('/assets/provider-error.png');
}

/**
 * @param {Record<string, unknown>} requestBody
 * @returns {string}
 */
function extractReplicateImageUrl(requestBody) {
  const maybeImageUrl = requestBody?.input?.image;
  return typeof maybeImageUrl === 'string' ? maybeImageUrl : '';
}

/**
 * @param {{
 *   error?: string,
 *   id: string,
 *   imageUrl: string,
 *   output?: string,
 *   pollCount: number,
 *   requiredPollCount: number,
 *   status: string,
 * }} prediction
 * @returns {{
 *   error?: string,
 *   id: string,
 *   input: { image: string },
 *   output?: string,
 *   status: string,
 * }}
 */
function buildReplicatePredictionPayload(prediction) {
  return {
    id: prediction.id,
    status: prediction.status,
    input: {
      image: prediction.imageUrl,
    },
    ...(prediction.status === 'succeeded' ? { output: prediction.output } : {}),
    ...(prediction.status === 'failed' || prediction.status === 'canceled'
      ? { error: prediction.error }
      : {}),
  };
}

/**
 * @param {{
 *   error?: string,
 *   id: string,
 *   imageUrl: string,
 *   output?: string,
 *   pollCount: number,
 *   requiredPollCount: number,
 *   status: string,
 * }} prediction
 * @returns {{
 *   error?: string,
 *   id: string,
 *   imageUrl: string,
 *   output?: string,
 *   pollCount: number,
 *   requiredPollCount: number,
 *   status: string,
 * }}
 */
function advanceReplicatePrediction(prediction) {
  if (['failed', 'canceled', 'succeeded'].includes(prediction.status)) {
    return prediction;
  }

  const nextPollCount = prediction.pollCount + 1;
  if (nextPollCount < prediction.requiredPollCount) {
    return {
      ...prediction,
      pollCount: nextPollCount,
      status: 'processing',
    };
  }

  if (prediction.error) {
    return {
      ...prediction,
      pollCount: nextPollCount,
      status: 'failed',
    };
  }

  return {
    ...prediction,
    pollCount: nextPollCount,
    status: 'succeeded',
    output: buildProviderCaption('replicate'),
  };
}

/**
 * @param {string} providerName
 * @returns {import('express').RequestHandler}
 */
function createOpenAiCompatibleStubHandler(providerName) {
  return (_req, res) => {
    res.json({
      id: `${providerName}-stub-response`,
      object: 'chat.completion',
      created: 1,
      model: `${providerName}-stub-model`,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: buildProviderCaption(providerName),
          },
        },
      ],
    });
  };
}

function createFixtureApp({ baseUrl = BASE_URL } = {}) {
  const app = express();
  app.use(express.json({ limit: OPENAI_COMPATIBLE_JSON_LIMIT }));
  const replicatePredictions = new Map();
  let nextReplicatePredictionId = 1;

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', source: 'postman-fixture-server' });
  });

  app.get('/fixtures/page-with-images', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Postman Harness Fixture</title>
  </head>
  <body>
    <h1>Fixture Page</h1>

    <!-- relative URL -->
    <img src="/assets/a.png" alt="" />

    <!-- absolute URL -->
    <img src="${baseUrl}/assets/b.png" alt="" />

    <!-- duplicate URL to validate dedupe + preserved order -->
    <img src="/assets/a.png" alt="" />
  </body>
</html>`);
  });

  app.get('/fixtures/page-with-partial-images', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Postman Harness Partial Fixture</title>
  </head>
  <body>
    <h1>Partial Fixture Page</h1>

    <!-- successful image -->
    <img src="/assets/a.png" alt="" />

    <!-- missing image to exercise page-level best-effort behavior -->
    <img src="/assets/missing.png" alt="" />

    <!-- duplicate successful image to ensure output order is preserved -->
    <img src="/assets/a.png" alt="" />
  </body>
</html>`);
  });

  app.get('/fixtures/page-with-provider-failure', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Postman Harness Provider Failure Fixture</title>
  </head>
  <body>
    <h1>Provider Failure Fixture Page</h1>

    <!-- successful image -->
    <img src="/assets/a.png" alt="" />

    <!-- image that forces the Azure stub to return a non-skippable provider error -->
    <img src="/assets/provider-error.png" alt="" />
  </body>
</html>`);
  });

  app.get('/provider-validation/page', (req, res) => {
    const requestBaseUrl = `${req.protocol}://${req.get('host')}`;
    res.type('html').send(buildProviderValidationPageHtml(requestBaseUrl));
  });

  app.get('/provider-validation/assets/:name', (req, res) => {
    const asset = getProviderValidationAsset(req.params.name);

    if (!asset) {
      res.status(404).type('text/plain').send('asset not found');
      return;
    }

    res.type('image/png').send(asset);
  });

  app.get('/assets/:name', (req, res) => {
    let asset = null;

    if (req.params.name === 'a.png') {
      asset = ASSET_A_PNG;
    } else if (req.params.name === 'b.png') {
      asset = ASSET_B_PNG;
    } else if (req.params.name === 'provider-error.png') {
      asset = ASSET_PROVIDER_FAILURE_PNG;
    }

    if (!asset) {
      res.status(404).type('text/plain').send('asset not found');
      return;
    }

    res.type('image/png').send(asset);
  });

  app.post('/openai/v1/chat/completions', createOpenAiCompatibleStubHandler('openai'));
  app.post('/huggingface/v1/chat/completions', createOpenAiCompatibleStubHandler('huggingface'));
  app.post('/openrouter/v1/chat/completions', createOpenAiCompatibleStubHandler('openrouter'));

  app.post('/predictions', (req, res) => {
    const imageUrl = extractReplicateImageUrl(req.body);
    const failingPrediction = isProviderFailureAssetUrl(imageUrl);
    const prediction = {
      id: `stub-prediction-${String(nextReplicatePredictionId).padStart(4, '0')}`,
      imageUrl,
      output: undefined,
      error: failingPrediction ? 'stub replicate provider failure' : undefined,
      pollCount: 0,
      requiredPollCount: failingPrediction
        ? REPLICATE_FAILURE_POLL_COUNT
        : REPLICATE_SUCCESS_POLL_COUNT,
      status: 'starting',
    };

    nextReplicatePredictionId += 1;
    replicatePredictions.set(prediction.id, prediction);

    res.status(201).json(buildReplicatePredictionPayload(prediction));
  });

  app.get('/predictions/:predictionId', (req, res) => {
    const currentPrediction = replicatePredictions.get(req.params.predictionId);

    if (!currentPrediction) {
      res.status(404).json({
        detail: 'prediction not found',
        status: 404,
        title: 'Not Found',
      });
      return;
    }

    const nextPrediction = advanceReplicatePrediction(currentPrediction);
    replicatePredictions.set(nextPrediction.id, nextPrediction);
    res.json(buildReplicatePredictionPayload(nextPrediction));
  });

  app.post('/predictions/:predictionId/cancel', (req, res) => {
    const currentPrediction = replicatePredictions.get(req.params.predictionId);

    if (!currentPrediction) {
      res.status(404).json({
        detail: 'prediction not found',
        status: 404,
        title: 'Not Found',
      });
      return;
    }

    const canceledPrediction = {
      ...currentPrediction,
      status: 'canceled',
      error: 'stub replicate prediction canceled',
    };
    replicatePredictions.set(canceledPrediction.id, canceledPrediction);
    res.json(buildReplicatePredictionPayload(canceledPrediction));
  });

  app.post('/vision/v3.2/describe', express.raw({ type: 'application/octet-stream' }), (req, res) => {
    const imageUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const imageBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (
      imageUrl.endsWith('/assets/provider-error.png')
      || Buffer.compare(imageBuffer, ASSET_PROVIDER_FAILURE_PNG) === 0
    ) {
      res.status(401).json({
        error: {
          code: 'PermissionDenied',
          message: 'stub provider authentication failure',
        },
      });
      return;
    }

    const caption = imageBuffer.length > 0
      ? captionForBuffer(imageBuffer)
      : captionForUrl(imageUrl);

    res.json({
      description: {
        captions: [{ text: caption }],
      },
    });
  });

  return app;
}

if (require.main === module) {
  createFixtureApp({ baseUrl: BASE_URL }).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`postman fixture server listening on ${BASE_URL}`);
  });
}

module.exports = {
  createFixtureApp,
  OPENAI_COMPATIBLE_JSON_LIMIT,
};
