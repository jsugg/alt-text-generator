<div align="center">
    <img src="https://raw.githubusercontent.com/jsugg/alt-text-generator/main/.github/assets/alt-text-generator.png" width="1000">
</div>

# Alt-Text 4 All

[![GitHub license](https://img.shields.io/github/license/jsugg/alt-text-generator)](https://github.com/jsugg/alt-text-generator/blob/main/LICENSE)
[![CI](https://github.com/jsugg/alt-text-generator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jsugg/alt-text-generator/actions/workflows/ci.yml)
[![Post Deploy Verification](https://github.com/jsugg/alt-text-generator/actions/workflows/post-deploy-verification.yml/badge.svg?branch=production)](https://github.com/jsugg/alt-text-generator/actions/workflows/post-deploy-verification.yml)
![Node CI 20 | 22 | 24](https://img.shields.io/badge/node%20CI-20%20%7C%2022%20%7C%2024-339933?logo=node.js&logoColor=white)

## Overview

Alt-Text 4 All is an HTTPS-first API that scrapes website images and generates AI-powered alt text to improve accessibility workflows.

The service exposes these primary capabilities:

- discover image URLs on a target page
- generate alt text for a specific image with provider-backed models such as `clip`, `azure`, `ollama`, `huggingface`, `openai`, `openrouter`, and `together`
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
  - or `OLLAMA_MODEL` / `OLLAMA_BASE_URL` for the `ollama` model
  - or `OPENAI_API_KEY`, `HF_API_KEY` / `HF_TOKEN`, `OPENROUTER_API_KEY`, or `TOGETHER_API_KEY`

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
npm run postman:full
npm run postman:pre-production-provider
npm run postman:live-provider -- --base-url https://wcag.qcraft.com.br
npm run postman:post-deploy -- --base-url https://wcag.qcraft.com.br
```

Notes:

- `postman:smoke` is the fast deterministic gate.
- `postman:full` runs the full local provider-integration suite, including protected-endpoint auth coverage, mocked provider-validation coverage, and JSON/JUnit reports under `reports/newman/`.
- CI also emits `reports/jest/junit.xml` from the canonical Node 20 Jest lane and publishes one combined GitHub test report that joins Jest and Newman results.
- `postman:pre-production-provider` boots the app locally and runs the low-cost real-provider validation set used immediately before promotion, currently Hugging Face plus OpenAI when both are configured.
- `postman:live-provider` is the production description-service validation command for deployed-app plus live-provider checks against a supplied base URL.
- `postman:post-deploy` runs post-deploy smoke plus the same low-cost real-provider validation set against a supplied base URL.
- Before Newman starts, `postman:live-provider` and `postman:post-deploy` wait for consecutive stable health/auth probes so zero-downtime rollout overlap does not create false negatives.
- When production auth is enabled, `postman:live-provider` and `postman:post-deploy` reuse `PRODUCTION_DEPLOY_VALIDATION_API_TOKEN` for provider-validation requests.
- CI runs `postman:smoke` on pull requests and `postman:full` on `main` / `production` pushes.
- Post-deploy verification runs `postman:post-deploy` on `production` pushes so smoke and low-cost provider checks stay inside the Newman contract layer.
- Post-deploy verification also reads `PRODUCTION_API_AUTH_ENABLED` and `PRODUCTION_DEPLOY_VALIDATION_API_TOKEN` from the GitHub Actions environment so protected-endpoint checks match the deployed Render `API_AUTH_ENABLED` / `API_AUTH_TOKENS` state.
- Provider-validation workflows use a single `LIVE_PROVIDER_SCOPE` enum: `auto`, `azure`, `replicate`, `huggingface`, `openai`, `openrouter`, or `all`.
- `LIVE_PROVIDER_SCOPE=auto` keeps the provider-validation preference order: Azure, then Replicate, then Hugging Face, then OpenRouter, then OpenAI.
- `provider_scope=all` runs every provider that is configured for that environment; it does not require every supported provider to be enabled everywhere.
- Local provider integration is fully mocked and never spends live provider credits.
- Pre-production and post-deploy use the low-cost Hugging Face plus OpenAI subset, while production live-provider validation can still run every configured provider against the same repo-controlled public provider-validation fixtures.
- `postman:smoke` and `postman:full` use the local Postman environment; `postman:live-provider` and `postman:post-deploy` use the live Postman environment.
- Outside GitHub Actions, set `PROVIDER_VALIDATION_PUBLIC_REF=<pushed-sha-or-ref>` if you need live-provider runs to use a branch-specific fixture revision before it lands on `main`.
- Production live-provider validation refuses localhost/private-network targets.
- Provider-validation runs upload Newman artifacts and append request, assertion, failure, and response-time metrics to the GitHub Actions step summary.
- Local harness runs accept self-signed development TLS.
- The deterministic full suite uses local stubs for Azure, Replicate, and OpenAI-compatible provider request shapes.

Contribution standards for the contract suite live in [docs/postman-standards.md](./docs/postman-standards.md).

## Allure Reports

Use these commands for local Allure generation:

```bash
npm run allure:clean
npm run test:allure
npm run postman:full:allure
npm run allure:generate
npm run allure:open
```

Or run the combined local flow:

```bash
npm run report:allure
```

Notes:

- Raw Allure files accumulate under `reports/allure-results/`; generated HTML is written to `reports/allure-report/`.
- The combined report merges one canonical Jest run with the Newman harness so local and CI results follow the same structure.
- CI uploads the generated HTML as the `allure-report` artifact.
- The public Pages deployment is `https://jsugg.github.io/alt-text-generator/`; the suites view is `https://jsugg.github.io/alt-text-generator/#suites`.
- Pushes to `main` publish the latest generated report through the `allure-pages` workflow deployment after the job finishes successfully.
- CI now keeps separate Allure history streams for `main` (`ci-main`) and same-repository pull requests (`ci-pr-<number>`), while deploy verification keeps its own `deploy-production` stream.
- GitHub Pages remains the public HTML surface for `main` only; PR and post-deploy verification reports are action artifacts.
- Same-repository PRs restore and persist their own history artifacts, so failure trends follow the PR instead of borrowing `main` history.
- Fork pull requests and custom post-deploy verification URLs stay ephemeral and do not restore or persist history artifacts.
- Manual post-deploy verification against the canonical production URL only persists history when `persist_history=true` is selected in the workflow dispatch form.
- CI only emits Jest Allure results from the Node 20 lane so unit tests do not appear three times in the merged report.
- The Allure CLI requires Java when you generate the HTML report locally or in CI.

## Runtime Essentials

Required at startup:

- At least one provider configuration:
  - `REPLICATE_API_TOKEN` to register `clip`
  - or `ACV_API_ENDPOINT` plus `ACV_SUBSCRIPTION_KEY` to register `azure`
  - or `OLLAMA_MODEL` / `OLLAMA_BASE_URL` to register `ollama`
  - or `OPENAI_API_KEY`, `HF_API_KEY` / `HF_TOKEN`, `OPENROUTER_API_KEY`, or `TOGETHER_API_KEY`
- Set `REPLICATE_ENABLED=false` when you need to keep a Replicate token configured but temporarily remove `clip` from the runtime and validation scope.

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
- `PAGE_DESCRIPTION_CONCURRENCY`
  - Optional positive integer
  - Defaults to `3`
  - Caps concurrent provider calls per page-description request to reduce rate-limit and cost spikes
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
When `WORKER_COUNT > 1`, configure a Redis-backed rate-limit store through `RATE_LIMIT_STORE=redis` (or `auto`). The default topology is external Redis via `REDIS_URL`/`RATE_LIMIT_REDIS_URL`, and a future-ready `RATE_LIMIT_REDIS_TOPOLOGY=unit-local` mode can default to `redis://127.0.0.1:6379` for a pod-local/sidecar Redis design. Startup validation blocks clustered mode without Redis.
Clustered mode applies bounded restart backoff and a crash budget so persistent worker faults do not spin forever inside the app process.
Production logs stay on the process stream so platforms such as Render can collect them directly.
The Render deployment shape is versioned in [render.yaml](./render.yaml), while the Node runtime pin remains in [`package.json`](./package.json) under `engines.node`.
`/api/ping` is the public liveness signal, while `/api/health` is a readiness endpoint: it returns `200` while the instance is ready and `503` while the process is draining during shutdown.

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
  - `model`: AI model identifier, such as `clip`, `azure`, `ollama`, `huggingface`, `openai`, `openrouter`, or `together`

Example:

```bash
curl -sk "https://localhost:8443/api/accessibility/description?image_source=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F1x%2Fgooglelogo_color_272x92dp.png&model=clip"
```

GET `/api/accessibility/descriptions` or `/api/v1/accessibility/descriptions`

- Summary: scrapes a page and returns descriptions for its images
- Query params:
  - `url`: URL-encoded address of the target website
  - `model`: AI model identifier, such as `clip`, `azure`, `ollama`, `huggingface`, `openai`, `openrouter`, or `together`
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
- repo-controlled production description-service validation against real providers

See [DEVELOPMENT.md](./DEVELOPMENT.md).

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
