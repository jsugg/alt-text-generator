# Development Guide

## Purpose

This document is the developer-facing runtime contract for the project. It covers local setup, environment variables, TLS requirements, quality gates, and live external-integration validation.

## Recommended Toolchain

- Node.js 20.x recommended
- npm 10+

Why Node 20:

- CI runs on Node 20 in `.github/workflows/ci-cd.yml`
- local validation is easier when the runtime matches CI

## Local Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Set at least:

```bash
REPLICATE_API_TOKEN=your-token-here
```

3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

5. Verify the local runtime:

```bash
curl -sk https://localhost:8443/api/health
curl -sk https://localhost:8443/api-docs/
```

## Environment Variables

### Required

| Variable | Required | Description |
| --- | --- | --- |
| `REPLICATE_API_TOKEN` | Yes | Replicate API token used by the `clip` describer. |

### Network and TLS

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `8080` | HTTP port. Requests are redirected to HTTPS. |
| `TLS_PORT` | No | `8443` | HTTPS port. |
| `TLS_KEY` | Prod: Yes, Dev: No | none | TLS private key. Can be a file path or inline PEM. |
| `TLS_CERT` | Prod: Yes, Dev: No | none | TLS certificate. Can be a file path or inline PEM. |

Development note:

- if `TLS_KEY` and `TLS_CERT` are unset, the app tries local `certs/localhost-key.pem` and `certs/localhost.pem`
- if those files are also absent, the app auto-generates a localhost self-signed certificate in-process for non-production runtime
- production still requires explicit TLS credentials

### Worker and Scraper Runtime Controls

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WORKER_COUNT` | No | `1` outside production, available parallelism in production | Overrides the number of cluster workers. |
| `SCRAPER_REQUEST_TIMEOUT_MS` | No | `10000` | Timeout for outbound page fetches. |
| `SCRAPER_MAX_REDIRECTS` | No | `5` | Redirect limit for outbound page fetches. |
| `SCRAPER_MAX_CONTENT_LENGTH_BYTES` | No | `2097152` | Maximum response body size accepted when scraping HTML. |

### Replicate

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `REPLICATE_API_ENDPOINT` | No | `https://api.replicate.com/v1/` | Override for stubs, proxies, or alternate environments. |
| `REPLICATE_USER_AGENT` | No | `alt-text-generator/1.0.0` | Replicate client user agent. |
| `REPLICATE_MODEL_OWNER` | No | `rmokady` | Replicate model owner. |
| `REPLICATE_MODEL_NAME` | No | `clip_prefix_caption` | Replicate model name. |
| `REPLICATE_MODEL_VERSION` | No | pinned in `config/index.js` | Replicate model version. |
| `OUTBOUND_CA_BUNDLE_FILE` | No | unset | App-managed supplemental PEM bundle used for outbound HTTPS trust. |

### Optional Azure Provider

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

Useful diagnostics:

```bash
npm run doctor:tls -- https://example.com
npm run doctor:tls -- https://example.com --fix --write-env --env-file .env.test
```

## External Integration Validation

### Validation goals

A professional validation pass should answer four separate questions:

1. Does the app boot and serve its HTTPS endpoints correctly?
2. Can the scraper reach and parse real public pages from the current runtime?
3. Can the app reach Replicate and execute the configured model with the current account?
4. Are failures caused by this codebase, the machine trust store, or the external vendor account?

Treat those as separate checks. Do not collapse them into a single smoke test.

### Recommended local validation profile

Use a local-only `.env.test` file for repeatable validation runs. Keep it out of Git.

Example:

```bash
cat > .env.test <<'EOF'
NODE_ENV=development
PORT=18084
TLS_PORT=18447
WORKER_COUNT=1
LOG_LEVEL=info
REPLICATE_API_TOKEN=replace-me
OUTBOUND_CA_BUNDLE_FILE=/absolute/path/to/certs/outbound-extra-ca.pem
EOF
```

Load it explicitly when validating:

```bash
set -a
source .env.test
set +a
ENV_FILE=.env.test node src/app.js
```

Or use the dedicated script:

```bash
npm run dev:test-env
```

Why this is better than ad hoc shell state:

- validation runs are reproducible
- contributors can share the exact local profile internally
- outbound CA fixes and temporary provider tokens stay out of committed files

### Validation matrix

| Check | Command / Endpoint | Expected result | Failure class |
| --- | --- | --- | --- |
| App boot | `node src/app.js` | HTTP and HTTPS listeners start cleanly | local config / TLS bootstrap |
| Health | `GET /api/health` | `200 OK` with health payload | local runtime |
| Docs | `GET /api-docs/` | `200 OK` | docs stack only |
| Scraper preflight | direct Node HTTPS request to target | `200` or site-specific expected status | trust store / target policy |
| Scraper API | `GET /api/scrapper/images?...` | `200` with `imageSources` array | scraper logic or target policy |
| Replicate reachability | direct SDK call or app route | vendor request accepted | token / endpoint / network |
| Replicate execution | `GET /api/accessibility/description?...&model=clip` | `200` with non-empty description | vendor account / model execution |
| Page description orchestration | `GET /api/accessibility/descriptions?...&model=clip` | `200` with ordered `descriptions` array | orchestration / provider reuse |

### Validation sequence

1. Start the app with the local validation profile.
2. Verify:

```bash
curl -sk https://localhost:8443/api/health
curl -sk https://localhost:8443/api-docs/
```

3. Preflight the external scrape target with the TLS doctor:

```bash
npm run doctor:tls -- https://developer.chrome.com/
```

4. If the preflight succeeds, validate the scraper route:

```bash
curl -sk 'https://localhost:8443/api/scrapper/images?url=https%3A%2F%2Fdeveloper.chrome.com%2F'
```

5. Validate Replicate through the app with a public image URL:

```bash
curl -sk 'https://localhost:8443/api/accessibility/description?image_source=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F1x%2Fgooglelogo_color_272x92dp.png&model=clip'
```

6. Validate the page-level orchestration route:

```bash
curl -sk 'https://localhost:8443/api/accessibility/descriptions?url=https%3A%2F%2Fdeveloper.chrome.com%2F&model=clip'
```

Expected:

- `descriptions` preserves duplicate image entries in page order
- `uniqueImages` is less than or equal to `totalImages`
- duplicate `imageUrl` values reuse the same description content in the response

7. Capture evidence from both the HTTP response and the app log. That lets you separate app defects from external-service failures.

### Interpreting failures

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
REPLICATE_API_ENDPOINT=http://127.0.0.1:19091 node src/app.js
```

Use that mode to validate routing, controller wiring, and provider integration mechanics. Use the real Replicate API only when validating actual vendor connectivity and account readiness.

## TLS and Outbound CA Troubleshooting

### Local server certificates

The app itself serves HTTPS locally. In development:

- set `TLS_KEY` and `TLS_CERT` to your own PEM files
- or set `TLS_KEY` and `TLS_CERT` to inline PEM values
- or place local cert files at `certs/localhost-key.pem` and `certs/localhost.pem`
- or rely on the built-in non-production self-signed localhost fallback

### Outbound HTTPS trust

The scraper and provider clients use the app's outbound TLS configuration, which starts from Node's trust store and can be extended with `OUTBOUND_CA_BUNDLE_FILE`. That distinction matters because curl and Node may not trust exactly the same roots on a given machine.

#### Root-cause workflow

1. Reproduce with Node directly:

```bash
node -e "require('https').get('https://example.com', (res) => { console.log(res.statusCode); res.resume(); }).on('error', console.error)"
```

2. Compare with curl:

```bash
curl -I https://example.com
```

3. If curl succeeds but Node fails, inspect the certificate chain and identify the missing trust anchor.

On this machine, `example.com` chains through:

- `Cloudflare TLS Issuing ECC CA 3`
- `SSL.com TLS Transit ECC CA R2`
- `AAA Certificate Services`

The macOS system keychain contains `AAA Certificate Services`, but this Node runtime does not trust it by default. That is why curl succeeds while Node fails.

#### Practical fix for this machine

Run the doctor in autofix mode:

```bash
npm run doctor:tls -- https://example.com --fix --write-env --env-file .env.test
```

That command:

- inspects the remote chain
- finds the missing trust anchor in the local platform trust source when possible
- writes an app-local bundle such as `certs/outbound-extra-ca.pem`
- updates `.env.test` with `OUTBOUND_CA_BUNDLE_FILE=/absolute/path/to/certs/outbound-extra-ca.pem`
- retries the probe and confirms success

Then run the app with:

```bash
ENV_FILE=.env.test node src/app.js
```

That fixes outbound Node HTTPS for `example.com` on this machine and, by extension, fixes the scraper path for that target.

#### Why this fix is correct

- it preserves TLS verification
- it adds the exact missing root instead of disabling security
- it is app-scoped and reproducible across shells, containers, and process managers
- it is consumed by both the scraper HTTP client and the Replicate client

Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` except as a temporary debugging aid. It disables certificate validation and is not an acceptable operating mode.

## Operational Notes

- HTTP requests redirect to HTTPS
- Swagger is lazy-loaded, so docs-only dependency warnings should not appear during ordinary startup or ordinary test paths
- cluster workers default to `1` outside production and scale to available parallelism in production unless `WORKER_COUNT` is set
