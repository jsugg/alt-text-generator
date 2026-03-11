# Development Guide

This is the developer-facing guide and validation runbook for this project.

If you only need a quick local boot, start with `README.md` and come back here for:

- full configuration reference (env vars and defaults)
- production-like external integration validation
- TLS and outbound trust troubleshooting (scraper and providers)
- auth and public error-contract behavior

## Table of Contents

- Quick Start (Dev)
- Common Commands
- GitHub Workflows
- Postman/Newman Harness
- Supported Models
- Configuration and Profiles
- Environment Variable Reference
- Quality Gates
- External Integration Validation Runbook
- TLS and Outbound Trust Troubleshooting
- Operational Notes
- Keeping This Doc Correct

## Quick Start (Dev)

Recommended toolchain:

- Node.js 20.x recommended (compatibility is validated on Node 20, 22, and 24)
- npm 10+

Boot locally:

```bash
cp .env.example .env
# edit .env and configure at least one provider
npm install
npm run dev
```

Smoke checks (use `-k` because local HTTPS may be self-signed):

```bash
curl -sk https://localhost:8443/api/health
curl -sk https://localhost:8443/api-docs/
```

## Common Commands

```bash
# dev
npm run dev
npm run dev:test-env

# quality
npm run lint
NODE_ENV=test REPLICATE_API_TOKEN=test-token npm test -- --runInBand
npm run postman:smoke
npm run postman:harness
npm run postman:deploy -- --base-url https://wcag.qcraft.com.br

# outbound TLS diagnostics
npm run doctor:tls -- https://example.com
npm run doctor:tls -- https://example.com --fix --write-env --env-file .env.test
```

## GitHub Workflows

The repository uses a small workflow set with separate responsibilities:

- `CI` in `.github/workflows/ci.yml`
  - runs on pushes to `main` and `production`
  - runs on pull requests targeting `main` and `production`
  - executes `actionlint`, `npm run lint`, the Jest matrix on Node 20/22/24, and the deterministic Newman harness
  - uses `postman:smoke` on pull requests and `postman:harness` on `main` / `production` pushes
  - publishes a Newman summary derived from JSON artifacts into the workflow summary
- `Dependency Review` in `.github/workflows/dependency-review.yml`
  - runs only on pull requests that change `package.json` or `package-lock.json`
  - blocks unsafe dependency changes before merge
- `CodeQL` in `.github/workflows/codeql.yml`
  - runs on pushes and pull requests for `main` and `production`
  - also runs on a weekly schedule for repository-wide static analysis
- `Security Audit` in `.github/workflows/security-audit.yml`
  - runs on a weekly schedule and by manual dispatch
  - executes `npm audit --omit=dev --audit-level=high`
  - uploads audit artifacts and fails when high or critical production dependency findings exist
- `Live Provider Validation` in `.github/workflows/live-provider-validation.yml`
  - manual only
  - runs `npm run postman:live`
  - uses the `prod-validation` GitHub Actions variable `LIVE_PROVIDER_SCOPE` with `auto`, `azure`, `replicate`, or `all`
  - requires GitHub Actions secrets, not Render env vars
  - requires `REPLICATE_API_TOKEN` only when the resolved scope includes Replicate
  - requires `ACV_API_ENDPOINT` plus `ACV_SUBSCRIPTION_KEY` only when the resolved scope includes Azure
  - also supports a guarded weekly schedule when the repository variable `ENABLE_SCHEDULED_LIVE_PROVIDER_VALIDATION` is set to `true`
  - uploads Newman artifacts and writes request, assertion, failure, and response-time metrics into the workflow summary
- `Deploy Verification` in `.github/workflows/deploy-verification.yml`
  - runs automatically on `production` pushes
  - runs `npm run postman:deploy -- --base-url <host>`
  - reuses the Postman deploy folders to verify hosted health, Swagger server URL, expected production auth behavior, protected scraper behavior, and one Azure-backed description endpoint
  - reads `PRODUCTION_API_AUTH_ENABLED` and `PRODUCTION_DEPLOY_VALIDATION_API_TOKEN` from the `prod-validation` GitHub Actions environment to match the deployed Render `API_AUTH_ENABLED` / `API_AUTH_TOKENS` state
- `Promote to Production` in `.github/workflows/promote-to-production.yml`
  - manual only
  - verifies that `main` has the required CI checks green
  - updates the `production` branch ref directly to the validated `main` commit so both branches end on the same tip SHA
  - treats `production` as a tracking branch for `main`; branch-only `production` history is realigned back to the validated `main` commit during promotion
  - requires a GitHub App installation token configured through `REPO_TOOLING_GITHUB_APP_ID` and `REPO_TOOLING_GITHUB_APP_PRIVATE_KEY`
  - also requires that GitHub App to be allowed to update the protected `production` branch ref

Branch protection currently requires these checks on both `main` and `production`:

- `actionlint`
- `lint`
- `newman`
- `test (20)`
- `test (22)`
- `test (24)`

Promotion branch note:

- after a successful promotion, `main` and `production` should point to the exact same commit SHA
- `main` is the canonical source branch; if `production` has branch-only history, promotion resets it back to the validated `main` commit

## Repository Automation GitHub App

Recommended configuration:

- name: `RepoToolingBot`
- install only on the `jsugg/alt-text-generator` repository
- repository permissions:
  - `Administration`: `Read-only`
  - `Checks`: `Read-only`
  - `Contents`: `Read and write`
  - `Metadata`: `Read-only` (default)
- webhook subscription: none required for the current workflow

Store the app credentials at the repository level:

- variable: `REPO_TOOLING_GITHUB_APP_ID`
- secret: `REPO_TOOLING_GITHUB_APP_PRIVATE_KEY`

Planned responsibilities for `RepoToolingBot`:

- production branch promotion and ref alignment
- post-promotion workflow dispatch and release verification
- repository quality/report automation that should run under a stable bot identity

The promotion workflow uses the app token when both values are present. This is required for exact-SHA promotion because `github.token` cannot update the protected `production` ref in this repository. Add the app to the protected-branch or ruleset bypass list for `production` so the workflow can move that ref directly, and keep using the app token so the resulting update can emit downstream workflow runs.

## Postman/Newman Harness

The repository includes a black-box contract harness that validates the API over real HTTP/HTTPS instead of through in-process Supertest only.

Modes:

- `npm run postman:smoke`
  - fast deterministic gate
  - covers core smoke, route aliases, protected-endpoint auth, scraper contract, one Azure-stubbed description, and routing checks
- `npm run postman:harness`
  - full deterministic suite
  - includes protected-endpoint auth, page descriptions, and negative-path coverage
  - writes JSON and JUnit reports to `reports/newman/`
- `npm run postman:live`
  - optional live-provider validation
  - intended for explicit live-provider checks, not default CI
  - supports Replicate-only, Azure-only, or combined validation through workflow env flags
- `npm run postman:deploy -- --base-url https://wcag.qcraft.com.br`
  - hosted deploy smoke verification
  - runs only the deploy folder from the shared Postman collection and writes `deploy.json` / `deploy.xml`

Contribution standards for folder naming, tier placement, and assertion policy are documented in [docs/postman-standards.md](./docs/postman-standards.md).

Deterministic harness characteristics:

- starts the local app on `https://127.0.0.1:8443` and `http://127.0.0.1:8080`
- starts an auth-enabled local app on `https://127.0.0.1:18443` for protected-endpoint contract checks
- starts a local fixture server on `http://127.0.0.1:19090`
- configures Azure to point at the fixture server stub endpoint
- uses a dummy `REPLICATE_API_TOKEN` if one is not already set
- runs Newman with insecure local TLS enabled because development certificates may be self-signed

Generated artifacts:

- `reports/newman/smoke.json`
- `reports/newman/smoke.xml`
- `reports/newman/core.json`
- `reports/newman/core.xml`
- `reports/newman/routing.json`
- `reports/newman/routing.xml`
- `reports/newman/live-provider.json`
- `reports/newman/live-provider.xml`
- `reports/newman/deploy.json`
- `reports/newman/deploy.xml`
- `reports/jest/junit.xml`

Use the deterministic modes for routine validation and CI. Use the live mode only when you deliberately want to validate vendor connectivity and account readiness.

## Supported Models

API routes that generate descriptions require a `model` query parameter. Today the runtime registers:

- `clip` (Replicate-backed)
- `azure` (Azure Computer Vision-backed, registered only when `ACV_API_ENDPOINT` and
  `ACV_SUBSCRIPTION_KEY` are set)

## Configuration and Profiles

### How env is loaded

The app loads environment variables via `dotenv` before it reads configuration:

- By default it reads `.env`
- If `ENV_FILE` is set, it reads that file instead and enables dotenv `override` for a reproducible profile

Recommended patterns:

- `.env` for day-to-day local dev
- `.env.test` for repeatable local validation (this repo ignores `.env.test` in Git)

### Suggested local validation profile

Example `.env.test` (edit values as needed):

```bash
NODE_ENV=development
PORT=18084
TLS_PORT=18447
WORKER_COUNT=1
LOG_LEVEL=info
REPLICATE_API_TOKEN=replace-me
# written by doctor:tls in many workflows:
OUTBOUND_CA_BUNDLE_FILE=/absolute/path/to/certs/outbound-extra-ca.pem
```

Start with the profile:

```bash
ENV_FILE=.env.test node src/app.js
```

Or use the dedicated script:

```bash
npm run dev:test-env
```

## Environment Variable Reference

Notes:

- The config single source of truth is `config/index.js`
- Validation rules are enforced by `src/utils/validateEnvVars.js` at startup
- Some behavior (example: default Replicate API base URL) is provided by upstream SDK defaults when unset

### Core

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | Valid values: `development`, `production`, `test`. |
| `REPLICATE_API_TOKEN` | No | none | Required only to register the `clip` provider and for real Replicate-backed descriptions. |
| `API_AUTH_ENABLED` | No | derived from `API_AUTH_TOKENS` | Explicitly enables or disables API auth. Defaults to `true` when `API_AUTH_TOKENS` contains at least one token, otherwise `false`. |
| `API_AUTH_TOKENS` | No | unset | Optional comma-separated API tokens. When API auth is enabled, scraper and description endpoints require either `Authorization: Bearer <token>` or `X-API-Key: <token>`. |
| `ENV_FILE` | No | `.env` | Selects which dotenv file to load at startup. Not validated by Joi. |

### Network and Inbound TLS (server)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `8080` | HTTP listener port (same app as HTTPS). |
| `TLS_PORT` | No | `8443` | HTTPS listener port. |
| `TLS_KEY` | Prod: Yes, Dev: No | none | TLS private key (inline PEM, base64-encoded PEM, or file path). Prefer absolute paths. |
| `TLS_CERT` | Prod: Yes, Dev: No | none | TLS certificate (inline PEM, base64-encoded PEM, or file path). Prefer absolute paths. |

Development TLS behavior:

- If `TLS_KEY` and `TLS_CERT` are set, they are used.
- If unset and `NODE_ENV` is not `production`, the app tries `certs/localhost-key.pem` and `certs/localhost.pem`.
- If those files are absent, the app generates a short-lived self-signed localhost certificate in-process.
- In production, explicit TLS credentials are required.

### Outbound TLS (scraper and providers)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OUTBOUND_CA_BUNDLE_FILE` | No | unset | App-managed supplemental PEM bundle used to extend Node trust for outbound HTTPS. |
| `NODE_EXTRA_CA_CERTS` | No | unset | Node-supported extra CA file. This app also accepts it as a fallback. Not validated by Joi. |

### Worker, Proxy, and Scraper Runtime Controls

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TRUST_PROXY_HOPS` | No | `1` | Number of proxy hops Express trusts when processing forwarded headers. Render production uses `1`. |
| `WORKER_COUNT` | No | `1` | Number of app processes to run. `1` uses single-process mode; values greater than `1` enable Node cluster mode. |
| `CLUSTER_RESTART_BACKOFF_MS` | No | `1000` | Base backoff for restarting an unexpectedly exited worker in cluster mode. |
| `CLUSTER_RESTART_MAX_BACKOFF_MS` | No | `30000` | Maximum backoff between clustered worker restart attempts. Must be greater than or equal to `CLUSTER_RESTART_BACKOFF_MS`. |
| `CLUSTER_CRASH_WINDOW_MS` | No | `60000` | Sliding window used to count clustered worker crashes. |
| `CLUSTER_MAX_CRASHES` | No | `5` | Maximum unexpected worker exits allowed inside the crash window before the primary exits non-zero. |
| `CLUSTER_SHUTDOWN_TIMEOUT_MS` | No | `10000` | Time the cluster primary waits for worker disconnect during shutdown before forcing exit. |
| `SCRAPER_REQUEST_TIMEOUT_MS` | No | `10000` | Timeout for outbound page fetches. |
| `SCRAPER_MAX_REDIRECTS` | No | `5` | Redirect limit for outbound page fetches. |
| `SCRAPER_MAX_CONTENT_LENGTH_BYTES` | No | `2097152` | Maximum response body size accepted when scraping HTML. |

### Replicate (clip provider)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `REPLICATE_API_ENDPOINT` | No | Replicate SDK default | Override for stubs, proxies, or alternate environments. |
| `REPLICATE_USER_AGENT` | No | `alt-text-generator/1.0.0` | Replicate client user agent. |
| `REPLICATE_MODEL_OWNER` | No | `rmokady` | Replicate model owner. |
| `REPLICATE_MODEL_NAME` | No | `clip_prefix_caption` | Replicate model name. |
| `REPLICATE_MODEL_VERSION` | No | pinned in `config/index.js` | Replicate model version. |

### Azure Computer Vision (optional provider)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ACV_API_ENDPOINT` | Yes, for Azure | unset | Azure Computer Vision describe endpoint. |
| `ACV_SUBSCRIPTION_KEY` | Yes, for Azure | unset | Preferred Azure subscription key. |
| `ACV_LANGUAGE` | No | `en` | Azure response language. |
| `ACV_MAX_CANDIDATES` | No | `4` | Maximum Azure caption candidates. |

`ACV_API_ENDPOINT` and `ACV_SUBSCRIPTION_KEY` must be set together or startup validation fails.
At least one provider must be configured at startup: `REPLICATE_API_TOKEN`, or Azure endpoint plus subscription key.

### Rate Limiting, Logging, and Swagger

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate-limit window. |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window. |
| `STATUS_RATE_LIMIT_WINDOW_MS` | No | `60000` | Dedicated rate-limit window for `/api/ping` and `/api/health`. |
| `STATUS_RATE_LIMIT_MAX` | No | `60` | Max status-route requests per window per client. |
| `LOG_LEVEL` | No | `debug` in non-production, `info` in production | Pino log level for process-stream logs. |
| `SWAGGER_DEV_URL` | No | `https://localhost:8443` | Swagger server URL for local development docs. |
| `SWAGGER_PROD_URL` | No | `https://wcag.qcraft.com.br` | Swagger server URL for production docs. |

- Logging stays on stdout so container platforms can collect it without relying on local files.
- Public endpoints remain `ping`, `health`, and `api-docs` even when API auth is enabled.
- `/api/ping` stays a liveness signal and continues returning `200` while the process is draining.
- `/api/health` is the readiness signal used by Render. It returns `200` while the instance is ready and `503` once graceful shutdown begins.
- Status routes use their own limiter so health probes are protected without sharing the main API request budget.
- Auth-protected API failures use a structured JSON contract with `error`, `code`, `requestId`, and optional `details`.

## Render Deployment Contract

- The Render web service shape is versioned in [`render.yaml`](./render.yaml).
- Render reads the Node runtime version from [`package.json`](./package.json) `engines.node`.
- Secrets such as `REPLICATE_API_TOKEN`, `TLS_KEY`, and `TLS_CERT` stay dashboard-managed and are represented in the Blueprint with `sync: false`.

## Quality Gates

Run these before pushing:

```bash
npm run lint
NODE_ENV=test REPLICATE_API_TOKEN=test-token npm test -- --runInBand
npm ci --dry-run
```

## External Integration Validation Runbook

### Validation goals

A production-quality validation pass should answer these separately:

1. Does the app boot and serve its HTTPS endpoints correctly?
2. Can the scraper reach and parse real public pages from the current runtime?
3. Can the app reach Replicate and execute the configured model with the current account?
4. Are failures caused by this codebase, the machine trust store, or the external vendor account?

Do not collapse those into a single smoke test. Treat them as separate checks.

### Validation matrix

| Check | Command / Endpoint | Expected result | Failure class |
| --- | --- | --- | --- |
| App boot | `ENV_FILE=.env.test node src/app.js` | HTTP and HTTPS listeners start cleanly | local config / TLS bootstrap |
| Health | `GET /api/health` | `200 OK` with health payload | local runtime |
| Docs | `GET /api-docs/` | `200 OK` | docs stack only |
| Scraper preflight | `npm run doctor:tls -- <target>` | `200` or site-specific expected status | trust store / target policy |
| Scraper API | `GET /api/scraper/images?...` | `200` with `imageSources` array | scraper logic or target policy |
| Replicate execution | `GET /api/accessibility/description?...&model=clip` | `200` with non-empty description | vendor account / model execution |
| Azure execution | `GET /api/accessibility/description?...&model=azure` | `200` with non-empty description | Azure credentials / model execution |
| Page orchestration | `GET /api/accessibility/descriptions?...&model=clip` | `200` with ordered `descriptions` array | orchestration / provider reuse |

### Validation sequence (recommended)

1. Start the app with the local validation profile.
2. Verify health and docs:

```bash
curl -sk https://localhost:8443/api/health
curl -sk https://localhost:8443/api-docs/
```

3. Preflight the external scrape target with the TLS doctor:

```bash
npm run doctor:tls -- https://developer.chrome.com/
```

4. If preflight succeeds, validate the scraper route:

```bash
curl -sk 'https://localhost:8443/api/scraper/images?url=https%3A%2F%2Fdeveloper.chrome.com%2F'
```

5. Validate Replicate through the app with a public image URL:

```bash
curl -sk 'https://localhost:8443/api/accessibility/description?image_source=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F1x%2Fgooglelogo_color_272x92dp.png&model=clip'
```

6. If Azure is configured, validate the Azure provider through the app:

```bash
curl -sk 'https://localhost:8443/api/accessibility/description?image_source=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F1x%2Fgooglelogo_color_272x92dp.png&model=azure'
```

7. Validate the page-level orchestration route:

```bash
curl -sk 'https://localhost:8443/api/accessibility/descriptions?url=https%3A%2F%2Fdeveloper.chrome.com%2F&model=clip'
```

Expected properties:

- `descriptions` preserves duplicate image entries in page order
- `uniqueImages` is less than or equal to `totalImages`
- duplicate `imageUrl` values reuse the same description content in the response

7. Capture evidence from the HTTP response and the app log (to separate app defects from vendor failures).

### Interpreting failures (common)

- `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
  - outbound trust-store problem for the current Node runtime
- `403` from the target site
  - the remote site is blocking or rejecting the scraper request
- `402 Payment Required` from Replicate
  - valid API path, but the account lacks credit
- `429 Too Many Requests` from Replicate
  - valid API path, but the account is throttled
- local `500` with no upstream HTTP response
  - likely application bug or unhandled runtime issue

### Deterministic validation without vendor spend

For deterministic local testing or CI-like validation, point the app at a local fixture-backed provider:

```bash
REPLICATE_API_ENDPOINT=http://127.0.0.1:19091 REPLICATE_API_TOKEN=test-token node src/app.js
```

Use the stub mode to validate routing and controller wiring. Use the real Replicate API when validating vendor connectivity and account readiness.

## TLS and Outbound Trust Troubleshooting

### Local server (inbound) HTTPS

In development you can:

- set `TLS_KEY` and `TLS_CERT` to inline PEM values
- set `TLS_KEY` and `TLS_CERT` to file paths (prefer absolute paths)
- place local cert files at `certs/localhost-key.pem` and `certs/localhost.pem`
- rely on the built-in non-production self-signed localhost fallback

### Outbound HTTPS trust (scraper and providers)

The scraper and provider clients start from Node's trust store and can be extended with a supplemental CA bundle.
This matters because curl and Node may not trust the exact same roots on a given machine.

#### Root-cause workflow

1. Reproduce with Node directly:

```bash
node -e "require('https').get('https://example.com', (res) => { console.log(res.statusCode); res.resume(); }).on('error', console.error)"
```

2. Compare with curl:

```bash
curl -I https://example.com
```

3. If curl succeeds but Node fails with an issuer or verification error, identify which trust anchor is missing for the Node runtime.

#### Practical fix (recommended)

Run the doctor in autofix mode:

```bash
npm run doctor:tls -- https://example.com --fix --write-env --env-file .env.test
```

What it does:

- inspects the remote certificate chain
- attempts to locate the missing trust anchor in the local system trust source
- writes/updates an app-local bundle (default `certs/outbound-extra-ca.pem`)
- updates the env file with `OUTBOUND_CA_BUNDLE_FILE=<absolute path>`
- retries the probe and confirms success

Then start the app with the profile:

```bash
ENV_FILE=.env.test node src/app.js
```

#### Why this fix is correct

- it preserves TLS verification
- it adds the missing root or intermediate without disabling security
- it is app-scoped and reproducible across shells and process managers
- it is consumed by both the scraper HTTP client and the Replicate client

Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` except as a temporary debugging aid.
It disables certificate validation and is not an acceptable operating mode.

## Operational Notes

- The app runs both HTTP and HTTPS listeners.
- For local development, prefer calling the HTTPS port directly (`https://localhost:8443/...`).
  - The HTTP to HTTPS redirect behavior depends on the incoming `Host` header and proxy layout.
- Swagger spec is lazy-loaded, so docs-only dependency warnings should not appear during ordinary startup or test paths.
- `WORKER_COUNT=1` runs the server as a single process with no internal cluster primary.
- Cluster mode is only enabled when `WORKER_COUNT > 1`.
- Cluster mode now applies restart backoff, crash-budget enforcement, and intentional-shutdown detection.
- Express trusts `TRUST_PROXY_HOPS` forwarded proxy hops, which defaults to `1` to match the current Render ingress layout.

## Keeping This Doc Correct

If you change configuration, update these together:

- `config/index.js` (defaults and wiring)
- `src/utils/validateEnvVars.js` (startup contract)
- `render.yaml` (Render deployment contract)
- this file (developer-facing reference and runbook)
