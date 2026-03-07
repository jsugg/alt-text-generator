# Development Guide

This is the developer-facing guide and validation runbook for this project.

If you only need a quick local boot, start with `README.md` and come back here for:

- full configuration reference (env vars and defaults)
- production-like external integration validation
- TLS and outbound trust troubleshooting (scraper and providers)

## Table of Contents

- Quick Start (Dev)
- Common Commands
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

- Node.js 20.x recommended (CI runs on Node 20)
- npm 10+

Boot locally:

```bash
cp .env.example .env
# edit .env and set REPLICATE_API_TOKEN (required even to boot)
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

# outbound TLS diagnostics
npm run doctor:tls -- https://example.com
npm run doctor:tls -- https://example.com --fix --write-env --env-file .env.test
```

## Supported Models

API routes that generate descriptions require a `model` query parameter. Today the runtime registers:

- `clip` (Replicate-backed)

There is an `AzureDescriberService` implementation in the codebase, but it is not currently registered in
the model registry exposed by the API, so setting `ACV_*` variables alone does not make an Azure model usable (yet).

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
| `REPLICATE_API_TOKEN` | Yes | none | Required for boot (env validation) and for real descriptions. |
| `ENV_FILE` | No | `.env` | Selects which dotenv file to load at startup. Not validated by Joi. |

### Network and Inbound TLS (server)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `8080` | HTTP listener port (same app as HTTPS). |
| `TLS_PORT` | No | `8443` | HTTPS listener port. |
| `TLS_KEY` | Prod: Yes, Dev: No | none | TLS private key (inline PEM or file path). Prefer absolute paths. |
| `TLS_CERT` | Prod: Yes, Dev: No | none | TLS certificate (inline PEM or file path). Prefer absolute paths. |

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

### Worker and Scraper Runtime Controls

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WORKER_COUNT` | No | `1` outside production, available parallelism in production | Overrides the number of cluster workers. |
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

### Azure Computer Vision (not currently wired into API models)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ACV_API_KEY` | No | unset | Azure Computer Vision API key. |
| `ACV_API_ENDPOINT` | No | unset | Azure Computer Vision endpoint. |
| `ACV_SUBSCRIPTION_KEY` | No | unset | Azure subscription key. |
| `ACV_LANGUAGE` | No | `en` | Azure response language. |
| `ACV_MAX_CANDIDATES` | No | `4` | Maximum Azure caption candidates. |

### Rate Limiting, Logging, and Swagger

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate-limit window. |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window. |
| `LOG_LEVEL` | No | `debug` in non-production, `info` in production | Pino log level. |
| `LOGS_DIR` | No | `./logs` | Directory for production log files. |
| `SWAGGER_DEV_URL` | No | `https://localhost:8443` | Swagger server URL for development. |
| `SWAGGER_PROD_URL` | No | `https://wcag.qcraft.dev` | Swagger server URL for production. |

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

6. Validate the page-level orchestration route:

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

For deterministic local testing or CI-like validation, point the app at a local stub:

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
- Cluster workers default to `1` outside production and scale to available parallelism in production unless `WORKER_COUNT` is set.

## Keeping This Doc Correct

If you change configuration, update these together:

- `config/index.js` (defaults and wiring)
- `src/utils/validateEnvVars.js` (startup contract)
- this file (developer-facing reference and runbook)
