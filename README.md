<div align="center">
    <img src="https://raw.githubusercontent.com/jsugg/alt-text-generator/main/.github/assets/alt-text-generator.png" width="1000">
</div>

# Alt-Text 4 All

[![GitHub license](https://img.shields.io/github/license/jsugg/alt-text-generator)](https://github.com/jsugg/alt-text-generator/blob/main/LICENSE)
[![Lint](https://github.com/jsugg/alt-text-generator/actions/workflows/ci-cd.yml/badge.svg?branch=main)](https://github.com/jsugg/alt-text-generator/actions/workflows/ci-cd.yml)
[![Tests](https://github.com/jsugg/alt-text-generator/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/jsugg/alt-text-generator/actions/workflows/tests.yml)
![Node CI 20 | 22 | 24](https://img.shields.io/badge/node%20CI-20%20%7C%2022%20%7C%2024-339933?logo=node.js&logoColor=white)

## Overview

Alt-Text 4 All is an HTTPS-first API that scrapes website images and generates AI-powered alt text to improve accessibility workflows.

The service exposes these primary capabilities:

- discover image URLs on a target page
- generate alt text for a specific image with the `clip` model or the `azure` model when Azure is configured
- generate alt text for all images on a page while preserving duplicate entries

## Features

- Website image scraping with relative URL resolution
- AI-generated descriptions for image URLs
- HTTPS-first local runtime with automatic HTTP -> HTTPS redirect
- Swagger UI for interactive API exploration
- Lint and test automation in CI
- Deterministic Postman/Newman API contract harness with local stubs

## Requirements

- CI validates Node 20, 22, and 24.
- `engines.node` is currently pinned to `20.x`; use Node 20 locally for the least friction.
- npm 10+
- A Replicate API token (required to boot; must be valid for real alt-text generation)

## Quick Start

```bash
git clone https://github.com/jsugg/alt-text-generator.git
cd alt-text-generator
cp .env.example .env
# edit .env and set REPLICATE_API_TOKEN
npm install
npm run dev
```

Local defaults:

- HTTPS listens on `https://localhost:8443`
- HTTP listens on `http://localhost:8080` and redirects to HTTPS
- Development TLS uses `TLS_KEY` / `TLS_CERT` if provided, then local `certs/localhost*.pem` if present, and otherwise auto-generates a localhost self-signed certificate in-process

Smoke checks:

```bash
curl -sk https://localhost:8443/api/health
curl -sk https://localhost:8443/api-docs/
```

Note: `-k` skips TLS certificate verification. It is used here because development HTTPS may be self-signed.
Do not use `-k` for production traffic.

## API Contract Harness

The repository includes a deterministic Postman/Newman harness that boots the app locally, starts a fixture server, and validates the public HTTP contract from outside the process.

Commands:

```bash
npm run postman:smoke
npm run postman:harness
npm run postman:live
```

Notes:

- `postman:smoke` is the fast deterministic gate.
- `postman:harness` runs the full deterministic suite and writes JSON and JUnit reports under `reports/newman/`.
- `postman:live` is optional and reserved for explicit live-provider validation.
- Live mode validates Replicate by default and also validates Azure when `ACV_API_ENDPOINT` and either `ACV_SUBSCRIPTION_KEY` or `ACV_API_KEY` are set.
- Local harness runs accept self-signed development TLS.
- The deterministic harness uses a local Azure stub and does not require real vendor credentials beyond a dummy Replicate token at app startup.

## Runtime Essentials

Required at startup:

- `REPLICATE_API_TOKEN` (required at startup; a dummy value is OK for stubbed-provider validation)

Required for live Azure descriptions:

- `ACV_API_ENDPOINT`
- `ACV_SUBSCRIPTION_KEY` or `ACV_API_KEY`
- The `azure` model is only registered when the endpoint and one Azure credential are set together.

Common local settings:

- `PORT` and `TLS_PORT`
- `TRUST_PROXY_HOPS`
  - Defaults to `1`
  - Controls how many proxy hops Express trusts for forwarded headers
- `TLS_KEY` and `TLS_CERT`
  - Optional in local development
  - Required in production
  - Can be file paths, inline PEM values, or base64-encoded PEM values
- `OUTBOUND_CA_BUNDLE_FILE`
  - Optional app-managed supplemental PEM bundle for outbound HTTPS trust
  - Use `npm run doctor:tls -- https://example.com --fix --write-env --env-file .env.test` when a target works in `curl` but fails in Node/app scraping

Advanced runtime settings such as worker count, scraper timeouts, rate limits, logging, Swagger URLs, and stubbed provider endpoints are documented in [DEVELOPMENT.md](./DEVELOPMENT.md).
`WORKER_COUNT=1` runs the app as a single process; cluster management is only enabled when `WORKER_COUNT > 1`.
Clustered mode applies bounded restart backoff and a crash budget so persistent worker faults do not spin forever inside the app process.
Production logs stay on the process stream so platforms such as Render can collect them directly.
The Render deployment shape is versioned in [render.yaml](./render.yaml), while the Node runtime pin remains in [`package.json`](./package.json) under `engines.node`.

## API Endpoints

### Swagger Documentation

Interactive documentation: `/api-docs`

### Images

GET `/api/scraper/images` or `/api/v1/scraper/images`

- Summary: returns image URLs found on a website
- Query params:
  - `url`: URL-encoded address of the target website

Example:

```bash
curl -sk "https://localhost:8443/api/scraper/images?url=https%3A%2F%2Fdeveloper.chrome.com%2F"
```

### Descriptions

GET `/api/accessibility/description` or `/api/v1/accessibility/description`

- Summary: returns an alt-text description for a given image
- Query params:
  - `image_source`: URL-encoded address of the image
  - `model`: AI model identifier, `clip` or `azure` when Azure is configured

Example:

```bash
curl -sk "https://localhost:8443/api/accessibility/description?image_source=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F1x%2Fgooglelogo_color_272x92dp.png&model=clip"
```

GET `/api/accessibility/descriptions` or `/api/v1/accessibility/descriptions`

- Summary: scrapes a page and returns descriptions for its images
- Query params:
  - `url`: URL-encoded address of the target website
  - `model`: AI model identifier, `clip` or `azure` when Azure is configured
- Notes:
  - preserves duplicate image entries in page order
  - reuses one prediction per unique normalized image URL per request

Example:

```bash
curl -sk "https://localhost:8443/api/accessibility/descriptions?url=https%3A%2F%2Fdeveloper.chrome.com%2F&model=clip"
```

## Development

Use the development guide for:

- complete environment-variable reference
- Postman/Newman harness usage and report interpretation
- TLS and outbound CA troubleshooting
- lint, test, and live validation commands
- real external-integration validation with live providers

See [DEVELOPMENT.md](./DEVELOPMENT.md).

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
