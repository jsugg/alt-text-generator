#!/usr/bin/env node

/**
 * Deterministic local fixture server for the Postman/Newman harness.
 *
 * It serves:
 * - a health endpoint
 * - a page with duplicate + mixed absolute/relative image references
 * - lightweight PNG assets
 * - a stub Azure Computer Vision describe endpoint
 */

const express = require('express');

const HOST = '127.0.0.1';
const PORT = Number(process.env.POSTMAN_FIXTURE_PORT || 19090);
const BASE_URL = `http://${HOST}:${PORT}`;

const app = express();
app.use(express.json());

const ASSET_A_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z/C/HwAF/gL+Nw3vAAAAAElFTkSuQmCC',
  'base64',
);

const ASSET_B_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8/5+hHgAHggJ/P0q/QwAAAABJRU5ErkJggg==',
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
    <img src="${BASE_URL}/assets/b.png" alt="" />

    <!-- duplicate URL to validate dedupe + preserved order -->
    <img src="/assets/a.png" alt="" />
  </body>
</html>`);
});

app.get('/assets/:name', (req, res) => {
  const asset = req.params.name === 'a.png' ? ASSET_A_PNG : ASSET_B_PNG;
  res.type('image/png').send(asset);
});

app.post('/vision/v3.2/describe', express.raw({ type: 'application/octet-stream' }), (req, res) => {
  const imageUrl = typeof req.body?.url === 'string' ? req.body.url : '';
  const imageBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const caption = imageBuffer.length > 0
    ? captionForBuffer(imageBuffer)
    : captionForUrl(imageUrl);

  res.json({
    description: {
      captions: [{ text: caption }],
    },
  });
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`postman fixture server listening on ${BASE_URL}`);
});
