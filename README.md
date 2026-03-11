<div align="center">
    <img src="https://raw.githubusercontent.com/jsugg/alt-text-generator/main/.github/assets/alt-text-generator.png" width="1000">
</div>

# Alt-Text 4 All

[![GitHub license](https://img.shields.io/github/license/jsugg/alt-text-generator)](https://github.com/jsugg/alt-text-generator/blob/main/LICENSE)
[![CI](https://github.com/jsugg/alt-text-generator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jsugg/alt-text-generator/actions/workflows/ci.yml)
[![Deploy Verification](https://github.com/jsugg/alt-text-generator/actions/workflows/deploy-verification.yml/badge.svg?branch=production)](https://github.com/jsugg/alt-text-generator/actions/workflows/deploy-verification.yml)
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
- Deterministic Postman/Newman API contract harness with local fixtures
- Optional token-based API access control for cost-bearing endpoints

## Requirements

- CI validates Node 20, 22, and 24.
- `engines.node` allows Node 20 through 24; use Node 20 locally for the least friction.
- npm 10+
- At least one provider configuration:
  - `REPLICATE_API_TOKEN` for the `clip` model
  - or `ACV_API_ENDPOINT` plus `ACV_SUBSCRIPTION_KEY` for the `azure` model

## Quick Start

```bash
git clone https://github.com/jsugg/alt-text-generator.git
cd alt-text-generator
cp .env.example .env
# edit .env and configure at least one provider
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
npm run postman:deploy -- --base-url https://wcag.qcraft.com.br
```

Notes:

- `postman:smoke` is the fast deterministic gate.
- `postman:harness` runs the full deterministic suite, including protected-endpoint auth coverage, and writes JSON and JUnit reports under `reports/newman/`.
- CI also emits `reports/jest/junit.xml` from the canonical Node 20 Jest lane and publishes one combined GitHub test report that joins Jest and Newman results.
- `postman:live` is optional and reserved for explicit live-provider validation.
- `postman:deploy` runs the hosted production-smoke folder from the same Postman collection against a supplied base URL.
- CI runs `postman:smoke` on pull requests and `postman:harness` on `main` / `production` pushes.
- Deploy verification runs `postman:deploy` on `production` pushes so hosted smoke checks stay inside the Newman contract layer.
- Deploy verification also reads `PRODUCTION_API_AUTH_ENABLED` and `PRODUCTION_DEPLOY_VALIDATION_API_TOKEN` from the GitHub Actions environment so hosted protected-endpoint checks can verify the expected Render `API_AUTH_ENABLED` / `API_AUTH_TOKENS` state.
- Live mode uses a single `LIVE_PROVIDER_SCOPE` enum: `auto`, `azure`, `replicate`, or `all`.
- `LIVE_PROVIDER_SCOPE=auto` prefers Azure when Azure credentials are configured and otherwise falls back to Replicate when a Replicate token exists.
- Live-provider runs upload Newman artifacts and append request, assertion, failure, and response-time metrics to the GitHub Actions step summary.
- Local harness runs accept self-signed development TLS.
- The deterministic harness uses a local Azure stub and can boot with a dummy Replicate token or Azure-only configuration.

Contribution standards for the contract suite live in [docs/postman-standards.md](./docs/postman-standards.md).

## Runtime Essentials

Required at startup:

- At least one provider configuration:
  - `REPLICATE_API_TOKEN` to register `clip`
  - or `ACV_API_ENDPOINT` plus `ACV_SUBSCRIPTION_KEY` to register `azure`

Required for live Azure descriptions:

- `ACV_API_ENDPOINT`
- `ACV_SUBSCRIPTION_KEY`
- The `azure` model is only registered when the endpoint and subscription key are set together.

Common local settings:

- `API_AUTH_ENABLED`
  - Optional boolean flag
  - Defaults to `true` when `API_AUTH_TOKENS` contains at least one token, otherwise `false`
  - When `true`, `API_AUTH_TOKENS` must contain at least one non-empty token
- `PORT` and `TLS_PORT`
- `API_AUTH_TOKENS`
  - Optional comma-separated tokens
  - When API auth is enabled, scraper and description endpoints require `Authorization: Bearer <token>` or `X-API-Key: <token>`
  - `ping`, `health`, and `api-docs` stay public
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

## Error Contract

Error responses keep the existing top-level `error` message and add stable metadata:

- `error`: human-readable message
- `code`: machine-readable error code
- `requestId`: request correlation id when available
- `details`: optional validation details for field-level failures

## API Endpoints

### Swagger Documentation

Interactive documentation: `/api-docs`

When API auth is enabled, use Swagger UI's `Authorize` flow with either a Bearer token or `X-API-Key`.

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
- GitHub Actions workflow and promotion guidance
- security and operational validation workflow guidance
- TLS and outbound CA troubleshooting
- lint, test, and live validation commands
- real external-integration validation with live providers

See [DEVELOPMENT.md](./DEVELOPMENT.md).

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
