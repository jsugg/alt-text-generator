#!/usr/bin/env node

/**
 * Deterministic local fixture server for the Postman/Newman harness.
 *
 * It serves:
 * - a health endpoint
 * - a page with duplicate + mixed absolute/relative image references
 * - lightweight SVG assets
 * - a stub Azure Computer Vision describe endpoint
 */

const express = require('express');

const HOST = '127.0.0.1';
const PORT = Number(process.env.POSTMAN_FIXTURE_PORT || 19090);
const BASE_URL = `http://${HOST}:${PORT}`;

const app = express();
app.use(express.json());

/**
 * Returns a deterministic caption for a given image URL.
 *
 * @param {string} imageUrl
 * @returns {string}
 */
function captionForUrl(imageUrl) {
  if (imageUrl.endsWith('/assets/a.svg')) {
    return 'stub caption for asset a';
  }

  if (imageUrl.endsWith('/assets/b.svg')) {
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
    <img src="/assets/a.svg" alt="" />

    <!-- absolute URL -->
    <img src="${BASE_URL}/assets/b.svg" alt="" />

    <!-- duplicate URL to validate dedupe + preserved order -->
    <img src="/assets/a.svg" alt="" />
  </body>
</html>`);
});

app.get('/assets/:name', (req, res) => {
  const color = req.params.name === 'a.svg' ? '#2563eb' : '#16a34a';

  res.type('image/svg+xml').send(`
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
  <rect width="120" height="80" fill="${color}" />
  <text x="10" y="45" fill="white" font-family="Arial, sans-serif" font-size="14">
    ${req.params.name}
  </text>
</svg>`.trim());
});

app.post('/vision/v3.2/describe', (req, res) => {
  const imageUrl = typeof req.body?.url === 'string' ? req.body.url : '';

  res.json({
    description: {
      captions: [{ text: captionForUrl(imageUrl) }],
    },
  });
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`postman fixture server listening on ${BASE_URL}`);
});
