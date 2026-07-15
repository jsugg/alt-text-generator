# Development Guide

This is the developer-facing guide and validation runbook for this project.

If you only need a quick local boot, start with `README.md` and come back here for:

- full configuration reference (env vars and defaults)
- production-like external integration validation
- TLS and outbound trust troubleshooting (scraper and providers)
- auth and public error-contract behavior

## Table of Contents

- [Quick Start (Dev)](#quick-start-dev)
- [Common Commands](#common-commands)
- [GitHub Workflows](#github-workflows)
- [Repository Automation GitHub App](#repository-automation-github-app)
- [Postman/Newman Harness](#postmannewman-harness)
- [Supported Models](#supported-models)
- [Configuration and Profiles](#configuration-and-profiles)
- [Environment Variable Reference](#environment-variable-reference)
- [Render Deployment Contract](#render-deployment-contract)
- [Quality Gates](#quality-gates)
- [External Integration Validation Runbook](#external-integration-validation-runbook)
- [TLS and Outbound Trust Troubleshooting](#tls-and-outbound-trust-troubleshooting)
- [Operational Notes](#operational-notes)
- [Keeping This Doc Correct](#keeping-this-doc-correct)

## Quick Start (Dev)

Recommended toolchain:

- Node.js 24.x (`.nvmrc` pins 24; Node 22 is also validated as a compatibility lane)
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
npm run validate:fast      # lint + openapi:validate/check + unit lane (pre-commit loop)
npm run validate:contract  # openapi:diff + postman:lint + postman:smoke (HTTP contract)
npm run validate:ci        # lint + openapi gates + test:ci + contract (CI repro; needs Redis)
npm run lint
npm run typecheck          # strict JSDoc typecheck (required, blocking CI gate)

# openapi contract
npm run openapi:generate   # regenerate docs/openapi.base.json from JSDoc sources
npm run openapi:validate   # structural validity of the committed spec
npm run openapi:check      # fail if the committed spec is stale vs the sources
npm run openapi:diff       # fail on backward-incompatible path/response changes
NODE_ENV=test REPLICATE_API_TOKEN=test-token npm test
NODE_ENV=test REPLICATE_API_TOKEN=test-token npm run test:integration
docker compose -f docker-compose.redis.yml --profile redis-test up -d redis-test
REDIS_INTEGRATION_URL=redis://127.0.0.1:6380 \
  NODE_ENV=test REPLICATE_API_TOKEN=test-token npm run test:integration:redis
docker compose -f docker-compose.redis.yml --profile redis-test down -v
NODE_ENV=test REPLICATE_API_TOKEN=test-token npm run test:integration:scripts
# WORKER_COUNT=2 cluster smoke: auto-runs in CI; opt in locally with CLUSTER_SMOKE=1
CLUSTER_SMOKE=1 REDIS_INTEGRATION_URL=redis://127.0.0.1:6380 \
  NODE_ENV=test REPLICATE_API_TOKEN=test-token npm run test:integration:redis
NODE_ENV=test REPLICATE_API_TOKEN=test-token npm run perf:smoke   # warning-only latency smoke
npm run postman:smoke
npm run postman:full
npm run postman:post-deploy -- --base-url https://wcag.qcraft.com.br

# outbound TLS diagnostics
npm run doctor:tls -- https://example.com
npm run doctor:tls -- https://example.com --fix --write-env --env-file .env.test
```

`npm run validate:fast` is the normal pre-commit loop: zero-warning lint plus the fast unit lane. `npm test` is the fast, deterministic Jest lane for `tests/unit` (no coverage or reporters). Every tier has its own package script and Jest config under `config/jest/`: `test:integration` (HTTP surface with in-memory adapters), `test:integration:redis` (Redis-backed rate limiting; required when invoked directly and in CI), and `test:integration:scripts` (git/filesystem subprocess flows; runs in-band with a 30s timeout because real clone/worktree/push/fetch flows cross process and filesystem boundaries). `test:all` composes every tier without coverage or reporters for compatibility checks, `test:coverage` composes every tier and enforces the coverage gate, `test:ci` adds JUnit (and Allure when `ALLURE_RESULTS_DIR` is set), and `test:allure` is the reporting-only Jest lane. CI job names map one-to-one to package scripts so a red job tells you exactly which `npm run` reproduces it. `test:integration:redis`, `test:coverage`, and `test:ci` require a Redis endpoint; `test:all` / `test:allure` may skip Redis only in optional local mode, and the skip prints a setup diagnostic.

Redis-backed specs are owned by the redis lane via the `*.redis.test.js` suffix — name a spec `something.redis.test.js` under `tests/integration/` and it joins `test:integration:redis` automatically (and is excluded from the in-memory `test:integration` lane). The redis lane covers shared rate-limit/job-store concurrency (`Promise.all` bursts where the shared counter or a single Redis claim must win exactly once) and a `WORKER_COUNT=2` cluster smoke that boots the real app on shared Redis and asserts startup, one shared rate-limit budget across workers, and graceful SIGTERM shutdown. The cluster smoke runs automatically in CI; locally it is opt-in via `CLUSTER_SMOKE=1` (and skips with a diagnostic otherwise) because cluster `fork()` plus heavy module load can hang under constrained local sandboxes. `npm run perf:smoke` is a warning-only performance smoke for page fan-out and warmed docs latency: it reports each route against a provisional budget and exits 0 even when a budget is exceeded. Promote a budget to a blocking gate only once it is agreed, by listing its label in `PERF_BUDGETS_ACCEPTED` (e.g. `PERF_BUDGETS_ACCEPTED=page-fan-out,docs-steady-state`); it is intentionally not part of the required CI gates yet.

### Validation tiers

Pick the cheapest tier that fully covers your change. Each `validate:*` script composes lower-level lanes, so a green tier locally means the matching CI job is green.

| Tier | Runs | When to run | Approx runtime |
| --- | --- | --- | --- |
| `validate:fast` | zero-warning ESLint + `openapi:validate` + `openapi:check` + deterministic unit lane | every save / pre-commit | ~1–1.5 min |
| `validate:contract` | `openapi:diff` + `postman:lint` + `postman:smoke` | before a PR that touches routes, controllers, or the OpenAPI contract | ~30–60 s |
| `validate:ci` | lint + OpenAPI gates + `test:ci` (every Jest tier plus the coverage gate, Redis-backed) + `validate:contract` | before pushing, or to reproduce a red CI run locally | ~3–5 min |

Runtimes are wall-clock on a developer laptop: `validate:fast` is measured, while the contract and CI tiers are budgets (the Newman suite holds a 15s performance budget, and `validate:ci` runs the full composed Jest matrix plus coverage). `validate:contract` and `validate:ci` boot the app and a fixture server; `validate:ci` additionally needs a Redis endpoint (`REDIS_INTEGRATION_URL` or a local `redis-server`), exactly like the CI `test:ci` job.

Debugging only: append `-- --runInBand` to a Jest lane (for example `npm test -- --runInBand`) to force serial execution when isolating a flaky or order-dependent test. It is not part of the normal validation path — the lanes already parallelize safely, and `test:integration:scripts` pins `--runInBand` itself because real clone/worktree/push/fetch flows cross process and filesystem boundaries.

Coverage scope and threshold exceptions live in `docs/coverage-thresholds.md`.

### OpenAPI contract gates

`config/swagger.js` serves the committed `docs/openapi.base.json` verbatim (injecting only the per-environment `servers` block), so that artifact is the source of truth for the public HTTP contract and ships to swagger-ui and downstream codegen. Three standalone gates keep it honest, and the CI `openapi` job runs all three:

- `openapi:validate` — structural soundness of the artifact: a 3.x version, info metadata, a server-agnostic base, documented responses with schemas, resolvable `$ref`s, and resolvable security schemes. Semantic choices (example values, enum members, which fields are `required`) are asserted by the swagger unit tests instead.
- `openapi:check` — freshness: regenerates the spec from the JSDoc sources and fails if it differs byte-for-byte from the committed file. A failure means a route or controller changed without `npm run openapi:generate`; the report lists the drifted paths/schemas.
- `openapi:diff` — backward compatibility: diffs the working-tree spec against a git baseline (`--base`, default `origin/main` then `main`) and fails only on breaking changes — a removed path, operation, response, or `required` response field. Additive changes pass. With no resolvable baseline it is a no-op unless `--strict` is given, so it never blocks on missing history. In CI it diffs against the pull-request base branch.

After changing routes, controllers, or `config/swagger-base.js`, run `npm run openapi:generate` and commit `docs/openapi.base.json`; `openapi:check` enforces that you did.

## GitHub Workflows

The repository gives each workflow a single responsibility:

- `CI` in `.github/workflows/ci.yml`
  - runs on pushes to `main` and `production`
  - runs on pull requests targeting `main` and `production`
  - executes `actionlint`, docs validation, `npm run lint`, OpenAPI validation, the strict JSDoc `typecheck` gate, the fast `test:unit` lane on Node 22/24, and the canonical Node 24 `test:ci` lane
  - uses `postman:smoke` as the required deterministic Newman contract gate on pull requests and pushes
  - treats Markdown/docs-only changes as lightweight: docs validation runs, while lint/OpenAPI/Jest/Newman jobs publish successful no-op checks instead of booting expensive gates
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
- `Production Description Service Validation` in `.github/workflows/live-provider-validation.yml`
  - manual only
  - runs `npm run postman:live-provider -- --base-url <host>`
  - reuses `PRODUCTION_DEPLOY_VALIDATION_API_TOKEN` when `PRODUCTION_API_AUTH_ENABLED=true`
  - uses the `prod-validation` GitHub Actions variable `LIVE_PROVIDER_SCOPE` with `auto`, `azure`, `replicate`, `huggingface`, `openai`, `openrouter`, `together`, or `all`
  - `provider_scope=all` expands to every provider configured in the `prod-validation` environment
  - validates the deployed production app end-to-end against live providers
  - requires GitHub Actions secrets to resolve scope and deployed Render env vars to actually serve provider-backed descriptions
  - requires `REPLICATE_API_TOKEN` only when the resolved scope includes Replicate
  - requires `ACV_API_ENDPOINT` plus `ACV_SUBSCRIPTION_KEY` only when the resolved scope includes Azure
  - requires `HF_API_KEY` only when the resolved scope includes Hugging Face
  - requires `OPENAI_API_KEY` only when the resolved scope includes OpenAI
  - requires `OPENROUTER_API_KEY` only when the resolved scope includes OpenRouter
  - also supports a guarded weekly schedule when the repository variable `ENABLE_SCHEDULED_LIVE_PROVIDER_VALIDATION` is set to `true`
  - uploads Newman artifacts and writes request, assertion, failure, and response-time metrics into the workflow summary
- `Local Provider Integration` in `.github/workflows/local-provider-integration.yml`
  - runs by manual dispatch, weekly schedule, risky pull requests targeting `main`, and risky pushes to `main`
  - runs `npm run postman:full`
  - boots the local app and local fixture server, then exercises mocked provider endpoints only
  - is path-gated to provider/API/Postman harness changes so CI does not duplicate `postman:full` on ordinary PRs
  - never targets the deployed Render service and never spends live provider credits
- `Post Deploy Verification` in `.github/workflows/post-deploy-verification.yml`
  - runs automatically on `production` pushes
  - runs `npm run postman:post-deploy -- --base-url <host>`
  - waits for consecutive stable health/auth probes before starting Newman so Render rollout overlap does not create deploy-smoke false negatives
  - verifies production health, Swagger server URL, expected production auth behavior, protected scraper behavior, and a low-cost live-provider subset
  - reads `PRODUCTION_API_AUTH_ENABLED` and `PRODUCTION_DEPLOY_VALIDATION_API_TOKEN` from the `prod-validation` GitHub Actions environment to match the deployed Render `API_AUTH_ENABLED` / `API_AUTH_TOKENS` state
- `Promote to Production` in `.github/workflows/promote-to-production.yml`
  - manual only
  - runs a pre-production low-cost live-provider validation against the local app before promotion
  - verifies that `main` has the required CI checks green
  - updates the `production` branch ref directly to the validated `main` commit so both branches end on the same tip SHA
  - treats `production` as a tracking branch for `main`; branch-only `production` history is realigned back to the validated `main` commit during promotion
  - requires a GitHub App installation token configured through `REPO_TOOLING_GITHUB_APP_ID` and `REPO_TOOLING_GITHUB_APP_PRIVATE_KEY`
  - also requires that GitHub App to be allowed to update the protected `production` branch ref
- `Allure Pages Publish` in `.github/workflows/allure-pages-publish.yml`
  - deploys the composed Allure site snapshot to GitHub Pages
  - triggered by `main` CI through `workflow_run`, dispatched explicitly by same-repository pull-request CI runs, and available manually with a `run_id` backfill input
  - details live in the Allure workflow notes under [Postman/Newman Harness](#postmannewman-harness)
- `Rollback Production` in `.github/workflows/rollback-production.yml`
  - manual, dry-run-first git rollback that moves the protected `production` ref back to a known-good SHA
- `Rollback Render Service` in `.github/workflows/rollback-render.yml`
  - manual, dry-run-first platform-native rollback that redeploys a previous known-good Render deploy through the Render API
  - both rollback paths are detailed under [Deployment evidence and rollback](#deployment-evidence-and-rollback)
- `Warm Production On Merge` in `.github/workflows/warm-on-merge.yml`
  - best-effort pings the production health endpoint on pushes to `main` to shorten free-tier cold start ahead of a likely promotion
- `Perf Smoke` in `.github/workflows/perf-smoke.yml`
  - monthly/manual advisory run of the warning-only `npm run perf:smoke` latency budgets; never a required check
- `Actions Storage Report` in `.github/workflows/actions-storage-report.yml`
  - monthly/manual advisory summary of GitHub Actions cache and artifact storage volume

Branch protection requires these checks on both `main` (branch protection) and `production` (repository ruleset); the policy source of truth is `config/github/required-checks.json` (see [docs/required-checks.md](./docs/required-checks.md)):

- `actionlint`
- `codeql`
- `dependency-review`
- `docs`
- `lint`
- `newman`
- `openapi`
- `test:ci (24)`
- `test:unit (24)`
- `typecheck`

Release policy notes:

- `newman` is the required fast `postman:smoke` contract check.
- Node 24 is the canonical gate: `test:unit (24)` is required, and `test:ci (24)` is the canonical full integration/coverage/reporting check. `test:unit (22)` still runs as a non-required compatibility signal.
- `typecheck` (strict JSDoc `checkJs`) is a required, blocking check; a single new type error fails the run.
- `postman:full` is covered by the path-gated/manual/scheduled Local Provider Integration workflow, not the always-required CI Newman check.
- `security-audit` is weekly/manual production dependency surveillance and is reviewed before release, but it is not a per-commit required status check.

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
- `npm run postman:full`
  - full local provider-integration suite
  - includes protected-endpoint auth, page descriptions, negative-path coverage, deterministic async `replicate` page-job success/failure coverage, and mocked provider-validation coverage for `replicate`, `azure`, `huggingface`, `openai`, and `openrouter`
  - writes JSON and JUnit reports to `reports/newman/`
- `npm run postman:full:allure`
  - runs the same local full suite with the Allure reporter enabled
  - appends raw Allure result files to `reports/allure-results/`
- `npm run postman:pre-production-provider`
  - low-cost real-provider validation against the local app
  - uses the Hugging Face, OpenAI, and Together subset when configured
  - reuses repo-controlled public provider-validation fixtures so results can be compared directly with post-deploy validation
- `npm run postman:live-provider`
  - production description-service validation
  - targets a deployed base URL and waits for rollout stabilization before starting Newman
  - uses repo-controlled public provider-validation fixtures
  - supports `azure`, `replicate`, `huggingface`, `openai`, `openrouter`, `together`, or `all` through `LIVE_PROVIDER_SCOPE`
  - follows async `202 Accepted` job polling automatically for slow providers such as Replicate-backed `replicate`
- `npm run postman:post-deploy -- --base-url https://wcag.qcraft.com.br`
  - post-deploy smoke verification
  - runs the post-deploy folders plus the same low-cost Hugging Face, OpenAI, and Together subset and writes `post-deploy*.json` / `post-deploy*.xml`
  - does not automatically run `replicate`; deterministic async `replicate` coverage stays in `postman:full`, while manual `postman:live-provider` can validate Replicate against production on demand

Contribution standards for folder naming, tier placement, and assertion policy are documented in [docs/postman-standards.md](./docs/postman-standards.md).

Deterministic harness characteristics:

- allocates free TCP ports dynamically per run by default, so concurrent harness runs never collide; resolved ports are passed to the app, auth app, and fixture servers and into Newman through `--env-var` overrides plus a generated `meta/newman-environment.resolved.json` environment file
- starts the local app, an auth-enabled local app (for protected-endpoint contract checks), and a local fixture server on those resolved ports (`127.0.0.1`)
- warms `/api-docs/` and `/api-docs/swagger-ui-init.js` before Newman so docs cold-start work does not fail the 15s Newman performance budget
- `postman:smoke` and `postman:full` use `postman/environments/alt-text-generator.local.postman_environment.json`
- `postman:live-provider` and `postman:post-deploy` use `postman/environments/alt-text-generator.live.postman_environment.json`
- configures mocked Azure, Replicate, and OpenAI-compatible providers to point at the fixture server stub endpoints during `postman:full`
- the Replicate fixture is stateful, so `postman:full` exercises real async `202 -> poll -> terminal` replicate page-job behavior instead of an instant-success shortcut
- uses shared provider-validation fixtures from `tests/fixtures/provider-validation/public` for `postman:pre-production-provider`, `postman:live-provider`, and `postman:post-deploy`
- runs Newman with insecure local TLS enabled because development certificates may be self-signed

Port allocation and per-run output (`postman:smoke` / `postman:full`):

- **Dynamic ports (default):** every run allocates fresh free TCP ports for the app, auth app, and fixture servers, so you can run multiple harness invocations at once without collisions. No configuration is required.
- **Fixed-port debug mode (opt-in):** set `POSTMAN_FIXED_PORTS=1` (or `POSTMAN_PORT_MODE=fixed`) to bind stable ports — `8080`/`8443` (app), `18080`/`18443` (auth app), `19090` (fixture) — overridable via `POSTMAN_APP_HTTP_PORT`, `POSTMAN_APP_HTTPS_PORT`, `POSTMAN_AUTH_HTTP_PORT`, `POSTMAN_AUTH_HTTPS_PORT`, and `POSTMAN_FIXTURE_PORT`. A preflight check fails fast with diagnostics listing any port that is already in use.
- **Per-run output dir:** artifacts are written under `<POSTMAN_REPORTS_DIR>/<run-id>/` (default base `reports/newman`). The run id is generated per run, or pinned with `POSTMAN_RUN_ID`. Each run directory holds the Newman `*.json`/`*.xml` reports plus `diagnostics/`, `meta/` (resolved ports + the resolved Newman environment file), and `allure-results/` (unless `ALLURE_RESULTS_DIR` is set for cross-run aggregation). Newman summary discovery recurses into run directories, so CI continues to find reports under `reports/newman`.
- **Plan-only:** set `POSTMAN_HARNESS_PLAN_ONLY=1` (or pass `--plan`) to resolve the ports + per-run directories, write the metadata files, print the plan, and exit before booting any servers.
- Run two smoke suites concurrently with: `POSTMAN_REPORTS_DIR=reports/newman npm run postman:smoke & POSTMAN_REPORTS_DIR=reports/newman npm run postman:smoke & wait` — each lands in its own run directory on its own allocated ports.

Harness artifacts (`postman:smoke` / `postman:full` / `postman:pre-production-provider`), per run under `reports/newman/<run-id>/` by default:

- `smoke.json` / `smoke.xml`
- `core.json` / `core.xml`
- `routing.json` / `routing.xml`
- `local-provider-integration-<scope>.json` / `.xml`
- `pre-production-provider-<scope>.json` / `.xml`
- `meta/resolved-ports.json` and `meta/newman-environment.resolved.json`
- `diagnostics/*.log`
- `allure-results/*` (or shared `reports/allure-results/*` when `ALLURE_RESULTS_DIR` is set)

The `postman:live-provider` and `postman:post-deploy` runners write directly under `reports/newman/`:

- `live-provider-<scope>.json` / `.xml`
- `post-deploy.json` / `.xml`
- `post-deploy-provider-<scope>.json` / `.xml`

Other artifacts:

- `reports/jest/junit.xml`
- `reports/allure-report/*`
- `reports/allure-history-artifact/*`

Use the deterministic local modes for routine validation and CI. Use `postman:pre-production-provider` immediately before promotion, `postman:post-deploy` right after production rollout, and `postman:live-provider` for manual or scheduled production health checks across all configured providers.

Allure workflow:

- `npm run test:allure` uses `config/jest/jest.reporting.cjs` and enables the official `allure-jest` adapter only for that run.
- `npm run postman:full:allure` enables the official Newman Allure reporter without removing the existing JSON/JUnit exports.
- `npm run report:allure` mirrors CI by cleaning old results, running Jest, running the deterministic Newman harness, and generating HTML from the merged `reports/allure-results/` directory.
- GitHub Actions publishes Allure from the canonical Node 24 Jest lane only so the Node 22 compatibility lane does not duplicate unit tests in the merged report.
- The public GitHub Pages deployment is `https://jsugg.github.io/alt-text-generator/`; the suites view is `https://jsugg.github.io/alt-text-generator/#suites`.
- Same-repository pull requests publish to `https://jsugg.github.io/alt-text-generator/pr/<number>/`, keeping a separate public Allure surface from `main`.
- The CI workflow resolves a stream-specific history policy before report generation. `main` uses `ci-main`, same-repository pull requests use `ci-pr-<number>`, and pushes to `production` do not persist CI branch history.
- The `allure-report` job restores Allure history from the most recent matching history artifact for that stream. `ci-main` falls back to the public root Pages report, and same-repository PRs fall back to their own `/pr/<number>/` Pages report when available.
- After generating the report, CI packages `reports/allure-report/history` into a dedicated `allure-history-*` artifact instead of reusing the full HTML bundle as the restore source.
- Pull requests from forks remain ephemeral: they generate the downloadable `allure-report` artifact but do not restore or persist history.
- The `allure-pages` job now composes a full static site snapshot and uploads it as a short-lived artifact. The follow-up `Allure Pages Publish` workflow deploys that artifact to GitHub Pages so `main` stays at the root while same-repository PR reports live under `/pr/<number>/`.
- `main` CI hands off to `Allure Pages Publish` through `workflow_run`, which is restricted to the `main` branch. Same-repository PR CI runs dispatch the publish workflow explicitly with their source `run_id`, keeping publication on the default-branch workflow code while still producing `/pr/<number>/` URLs before merge.
- `Allure Pages Publish` still exposes `workflow_dispatch` with a `run_id` input so a specific CI run can be republished or backfilled after the workflow lands on `main`. The publish workflow also accepts completed CI runs that produced an Allure artifact even if later jobs in that CI run failed.
- The publish workflow checks out the repository so it can reuse the shared Node helpers, deploys the composed site with the official Pages actions, and then syncs the exact deployed snapshot back to `gh-pages`. That branch is no longer the publication trigger, but it remains the durable snapshot source that future `compose-pages-site` runs merge against.
- Post-deploy verification now emits Allure output as well. Pushes to `production` persist a `deploy-production` history stream, while manual post-deploy verification runs only persist that stream when the workflow dispatch input `persist_history=true` is selected for the canonical production URL.

## Supported Models

API routes that generate descriptions require a `model` query parameter. Today the runtime registers:

- `replicate` (Replicate-backed)
  - single-image and page-description requests can return `202 Accepted` with a job payload when the provider stays slow beyond the configured inline wait window
- `azure` (Azure Computer Vision-backed, registered only when `ACV_API_ENDPOINT` and
  `ACV_SUBSCRIPTION_KEY` are set)
- `ollama` (local/self-hosted Ollama, registered when `OLLAMA_MODEL` or `OLLAMA_BASE_URL` is set)
- `huggingface` (Hugging Face's OpenAI-compatible router, registered when `HF_API_KEY` or `HF_TOKEN` is set)
- `openai` (OpenAI multimodal chat, registered when `OPENAI_API_KEY` is set)
- `openrouter` (OpenRouter multimodal chat, registered when `OPENROUTER_API_KEY` is set)
- `together` (Together AI multimodal chat, registered when `TOGETHER_API_KEY` is set)

## Configuration and Profiles

### How env is loaded

The app loads environment variables via `dotenv` before it reads configuration:

- By default it reads `.env`
- If `ENV_FILE` is set, it reads that file instead and enables dotenv `override` for a reproducible profile

Recommended patterns:

- `.env` for day-to-day local dev
- `.env.test` for repeatable local validation (this repo ignores `.env.test` in Git)

### Provider overrides

`config/providers.yaml` can force a provider on or off independently of its
environment variables. Set `PROVIDER_OVERRIDES_FILE` to point at a different YAML
file when you need an alternate override set.

```yaml
providers:
  azure:
    enabled: auto   # auto (default): defer to env; false: stay disabled even when ACV_* is set
```

- `enabled: false` keeps a provider unregistered even when its env vars are present.
- `enabled: auto` (the default) defers to the normal env-driven registration.
- `enabled: true` is accepted and behaves like `auto`; registration still requires the provider's env configuration.
- Providers absent from the file follow normal env-driven behavior.

### Suggested local validation profile

Example `.env.test` (edit values as needed):

```bash
NODE_ENV=development
PORT=18084
TLS_PORT=18447
WORKER_COUNT=1
LOG_LEVEL=info
REPLICATE_API_TOKEN=replace-me
PAGE_DESCRIPTION_CONCURRENCY=3
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
| `REPLICATE_API_TOKEN` | No | none | Required only to register the `replicate` provider and for real Replicate-backed descriptions. |
| `PAGE_DESCRIPTION_CONCURRENCY` | No | `3` | Max concurrent provider calls during one page-description request. |
| `API_AUTH_ENABLED` | No | derived from `API_AUTH_TOKENS` | Explicitly enables or disables API auth. Defaults to `true` when `API_AUTH_TOKENS` contains at least one token, otherwise `false`. |
| `API_AUTH_TOKENS` | No | unset | Optional comma-separated API tokens. When API auth is enabled, scraper and description endpoints require either `Authorization: Bearer <token>` or `X-API-Key: <token>`. |
| `ENV_FILE` | No | `.env` | Selects which dotenv file to load at startup. Not validated by Joi. |
| `PROVIDER_OVERRIDES_FILE` | No | `config/providers.yaml` | Path to the YAML provider enable/disable override file. Not validated by Joi. |

### Network and Inbound TLS (server)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `8080` | HTTP listener port (same app as HTTPS). Platforms that inject a port (Render, Heroku, Cloud Run) set this automatically. |
| `TLS_ENABLED` | No | `true` | When `false`, the app runs HTTP-only: it binds `PORT`, skips certificate loading, and never starts the HTTPS listener. Set `false` only where TLS terminates at the platform edge (see [Inbound TLS posture](#inbound-tls-posture-https-first-vs-edge-termination)). |
| `TLS_PORT` | No | `8443` | HTTPS listener port. Ignored when `TLS_ENABLED=false`. |
| `TLS_KEY` | Prod (in-process TLS): Yes | none | TLS private key (inline PEM, base64-encoded PEM, or file path). Prefer absolute paths. Not needed when `TLS_ENABLED=false`. |
| `TLS_CERT` | Prod (in-process TLS): Yes | none | TLS certificate (inline PEM, base64-encoded PEM, or file path). Prefer absolute paths. Not needed when `TLS_ENABLED=false`. |

Development TLS behavior (applies when `TLS_ENABLED` is not `false`):

- If `TLS_KEY` and `TLS_CERT` are set, they are used.
- If unset and `NODE_ENV` is not `production`, the app tries `certs/localhost-key.pem` and `certs/localhost.pem`.
- If those files are absent, the app generates a short-lived self-signed localhost certificate in-process.
- In production, explicit TLS credentials are required — unless `TLS_ENABLED=false`, in which case they are neither required nor loaded.

The in-process HTTPS listener is covered end-to-end by `tests/integration/httpsListener.test.js`, which stands up `createHttpsServer` with the loaded credentials and asserts a real TLS handshake (`socket.encrypted === true`).

#### Inbound TLS posture: HTTPS-first vs. edge termination

This service is **HTTPS-first by default.** Out of the box it starts an in-process HTTPS listener, self-signs a localhost certificate for development, redirects HTTP → HTTPS (`src/api/v1/middleware/request-filter.js`, keyed on `X-Forwarded-Proto`), and emits HSTS via `helmet`. A plain `git clone` and run gives you TLS with no extra setup, and self-hosters terminating their own TLS keep this behavior unchanged.

**The managed deployment (Render) intentionally runs with `TLS_ENABLED=false`.** On Render — and any comparable PaaS — TLS terminates at the platform edge: the edge holds the managed certificate for `wcag.qcraft.com.br`, serves clients over HTTPS, and forwards requests to the container as plain HTTP over the provider's private network on the injected `$PORT`. Running the app's own HTTPS listener there would be redundant and harmful: it would bind a second port the edge never probes and would require certificates that do not exist in that environment. So on Render the app serves HTTP-only on `$PORT`, and the edge owns TLS.

Public traffic is still end-to-end HTTPS to the client; only the edge→app hop inside the provider network is HTTP. HTTPS *enforcement* still holds behind the edge because `X-Forwarded-Proto: https` (set by the edge) drives `req.secure`, the HTTP→HTTPS redirect, secure-cookie flags, and HSTS — provided `TRUST_PROXY_HOPS` matches the ingress (see [Worker, Proxy, and Scraper Runtime Controls](#worker-proxy-and-scraper-runtime-controls)). This edge-termination model is also why the Node 24 cutover deploy boots in seconds: no certificate load, no second listener to stand up.

### Outbound TLS (scraper and providers)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OUTBOUND_CA_BUNDLE_FILE` | No | unset | App-managed supplemental PEM bundle used to extend Node trust for outbound HTTPS. |
| `OUTBOUND_ALLOWED_HOSTS` | No | unset | Comma-separated `host[:port]` allowlist for outbound fetches. **Each entry bypasses the private-network SSRF guard** — see [Outbound host allowlist](#outbound-host-allowlist) before setting it. |
| `NODE_EXTRA_CA_CERTS` | No | unset | Node-supported extra CA file. This app also accepts it as a fallback. Not validated by Joi. |

#### Outbound host allowlist

`OUTBOUND_ALLOWED_HOSTS` names hosts that outbound fetches may reach **without
the private-network check**. Read this before setting it: it is the one setting
here that can turn the scraper into an SSRF primitive.

**Syntax.** A comma-separated list of `host[:port]` entries, validated at boot:

```dotenv
OUTBOUND_ALLOWED_HOSTS=127.0.0.1:19090,fixtures.internal:8080
```

**Semantics.** Matching is exact and case-normalized against the URL's `host`
(with port) or `hostname` (without). There are **no wildcards and no suffix
matching** — `example.com` does not match `api.example.com`, and
`example.com:8443` does not match `example.com`. Entries are compared verbatim
(`src/infrastructure/outboundUrlPolicy.js`).

**What it bypasses.** A matching host returns *before* `assertPublicAddress()`
and before DNS resolution, which are the guards that stop the app from being
pointed at loopback, link-local, or private-range addresses. An allowlisted host
that resolves to `169.254.169.254` will be fetched. That is the entire point of
the setting, and the entire risk of it.

**Use it for** a local fixture or test-harness origin — which is what
`npm run postman:full` does. **Do not use it** to work around a legitimate
rejection of a public host; nothing about the allowlist is scoped to a path,
method, or protocol.

### Worker, Proxy, and Scraper Runtime Controls

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TRUST_PROXY_HOPS` | No | `1` | Number of proxy hops Express trusts when reading `X-Forwarded-*` headers. Must equal the count of trusted proxies in front of the app: Render's edge is one hop, so `1` (also the code default). This governs whether `req.secure` / `req.protocol` reflect the edge's TLS, which in turn drives the HTTP→HTTPS redirect, secure-cookie flags, and HSTS — so it is required for correct HTTPS behavior under [edge termination](#inbound-tls-posture-https-first-vs-edge-termination). Set it explicitly on the Render service (do not rely on the default), and raise it (e.g. `2`) if you front Render with another proxy or CDN such as Cloudflare, so forwarded headers are trusted at the correct hop and cannot be spoofed. |
| `WORKER_COUNT` | No | `1` | Number of app processes to run. `1` uses single-process mode; values greater than `1` enable Node cluster mode. |
| `CLUSTER_RESTART_BACKOFF_MS` | No | `1000` | Base backoff for restarting an unexpectedly exited worker in cluster mode. |
| `CLUSTER_RESTART_MAX_BACKOFF_MS` | No | `30000` | Maximum backoff between clustered worker restart attempts. Must be greater than or equal to `CLUSTER_RESTART_BACKOFF_MS`. |
| `CLUSTER_CRASH_WINDOW_MS` | No | `60000` | Sliding window used to count clustered worker crashes. |
| `CLUSTER_MAX_CRASHES` | No | `5` | Maximum unexpected worker exits allowed inside the crash window before the primary exits non-zero. |
| `CLUSTER_SHUTDOWN_TIMEOUT_MS` | No | `10000` | Time the cluster primary waits for worker disconnect during shutdown before forcing exit. |
| `REDIS_URL` | No | unset | Shared Redis URL used automatically for rate limiting when `RATE_LIMIT_STORE=auto` and no explicit `RATE_LIMIT_REDIS_URL` is provided. |
| `SCRAPER_REQUEST_TIMEOUT_MS` | No | `10000` | Timeout for outbound page fetches and provider HTTP calls. The Render service raises this to `90000`: hosted vision models routinely take more than 10s per image, and the free-tier instance is slower still. |
| `SCRAPER_MAX_REDIRECTS` | No | `5` | Redirect limit for outbound page fetches. |
| `SCRAPER_MAX_CONTENT_LENGTH_BYTES` | No | `2097152` | Maximum response body size accepted when scraping HTML. |

### Async Description Job Controls

These settings govern the single-image async handoff used by slow providers such as `replicate`.
The current implementation uses provider polling rather than inbound webhooks.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DESCRIPTION_JOB_STORE` | No | `auto` | Storage mode: `auto`, `memory`, or `redis`. `auto` promotes to Redis when a Redis URL is available. |
| `DESCRIPTION_JOB_REDIS_URL` | No | falls back to `REDIS_URL`, then `RATE_LIMIT_REDIS_URL` | Explicit Redis URL for async description jobs. |
| `DESCRIPTION_JOB_REDIS_PREFIX` | No | `alt-text-generator:description-jobs:` | Redis key prefix for stored description jobs. |
| `DESCRIPTION_JOB_WAIT_TIMEOUT_MS` | No | `5000` | Inline wait budget before the API returns `202 Accepted` with a job payload. |
| `DESCRIPTION_JOB_POLL_INTERVAL_MS` | No | `1000` | Poll cadence used while waiting for an async job to settle. |
| `DESCRIPTION_JOB_PENDING_TTL_MS` | No | `900000` | TTL for pending async jobs. |
| `DESCRIPTION_JOB_COMPLETED_TTL_MS` | No | `86400000` | TTL for completed async jobs. |
| `DESCRIPTION_JOB_FAILED_TTL_MS` | No | `300000` | TTL for failed async jobs. |
| `DESCRIPTION_JOB_CLAIM_TTL_MS` | No | `30000` | Lease window used to keep one runner responsible for a pending async description job while it is actively processing. |

### Replicate

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `REPLICATE_API_ENDPOINT` | No | Replicate SDK default | Override for stubs, proxies, or alternate environments. |
| `REPLICATE_USER_AGENT` | No | `alt-text-generator/1.0.0` | Replicate client user agent. |
| `REPLICATE_MODEL_OWNER` | No | `rmokady` | Replicate model owner. |
| `REPLICATE_MODEL_NAME` | No | `clip_prefix_caption` | Replicate model name. |
| `REPLICATE_MODEL_VERSION` | No | pinned in `src/providers/definitions/replicate.js` | Replicate model version. |
| `REPLICATE_REQUEST_TIMEOUT_MS` | No | `15000` | Hard timeout for synchronous `describeImage()` calls before the prediction is canceled and surfaced as `DESCRIPTION_PROVIDER_TIMEOUT`. |
| `REPLICATE_POLL_INTERVAL_MS` | No | `500` | Poll interval used while waiting on Replicate prediction status. |

### Azure Computer Vision (optional provider)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ACV_API_ENDPOINT` | Yes, for Azure | unset | Azure Computer Vision describe endpoint. |
| `ACV_SUBSCRIPTION_KEY` | Yes, for Azure | unset | Preferred Azure subscription key. |
| `ACV_LANGUAGE` | No | `en` | Azure response language. |
| `ACV_MAX_CANDIDATES` | No | `4` | Maximum Azure caption candidates. |

`ACV_API_ENDPOINT` and `ACV_SUBSCRIPTION_KEY` must be set together or startup validation fails.
At least one provider must be configured at startup: `REPLICATE_API_TOKEN`, Azure credentials, an Ollama opt-in (`OLLAMA_MODEL` or `OLLAMA_BASE_URL`), or one of the OpenAI-compatible API keys (`OPENAI_API_KEY`, `HF_API_KEY`/`HF_TOKEN`, `OPENROUTER_API_KEY`, or `TOGETHER_API_KEY`).

### Ollama (optional provider)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OLLAMA_BASE_URL` | No | `http://127.0.0.1:11434` | Ollama server base URL. Setting this or `OLLAMA_MODEL` registers `ollama`. |
| `OLLAMA_MODEL` | No | `llama3.2-vision` | Ollama multimodal model name. Setting this or `OLLAMA_BASE_URL` registers `ollama`. |
| `OLLAMA_PROMPT` | No | shared alt-text prompt | Prompt sent with the image. |
| `OLLAMA_KEEP_ALIVE` | No | unset | Optional Ollama keep-alive hint such as `5m`. |

### OpenAI-compatible multimodal providers

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | No | none | Registers `openai`. |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | Override for proxies or compatible gateways. |
| `OPENAI_MODEL` | No | `gpt-4.1-nano` | Default OpenAI multimodal model. |
| `OPENAI_MAX_TOKENS` | No | `160` | Max completion tokens for `openai`. |
| `OPENAI_PROMPT` | No | shared alt-text prompt | Prompt sent with the image. |
| `HF_API_KEY` | No | none | Registers `huggingface`. `HF_TOKEN` is accepted as an alias. |
| `HF_BASE_URL` | No | `https://router.huggingface.co/v1` | Hugging Face router base URL. |
| `HF_MODEL` | No | `Qwen/Qwen3-VL-30B-A3B-Instruct:fastest` | Default Hugging Face image-to-text route, preferring the router's fastest live provider. |
| `HF_MAX_TOKENS` | No | `160` | Max completion tokens for `huggingface`. |
| `HF_PROMPT` | No | shared alt-text prompt | Prompt sent with the image. |
| `OPENROUTER_API_KEY` | No | none | Registers `openrouter`. |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` | OpenRouter base URL. |
| `OPENROUTER_MODEL` | No | `google/gemma-3-4b-it:free` | Default OpenRouter image-caption model for low-cost validation, using a free image-capable route when available. |
| `OPENROUTER_MAX_TOKENS` | No | `160` | Max completion tokens for `openrouter`. |
| `OPENROUTER_PROMPT` | No | shared alt-text prompt | Prompt sent with the image. |
| `OPENROUTER_HTTP_REFERER` | No | unset | Optional OpenRouter attribution header. |
| `OPENROUTER_TITLE` | No | unset | Optional OpenRouter application title header. |
| `TOGETHER_API_KEY` | No | none | Together AI API key. Registers `together`. |
| `TOGETHER_BASE_URL` | No | `https://api.together.xyz/v1` | Together AI base URL. |
| `TOGETHER_MODEL` | No | `Qwen/Qwen3.5-9B` | Default Together multimodal model. |
| `TOGETHER_MAX_TOKENS` | No | `160` | Max completion tokens for `together`. |
| `TOGETHER_PROMPT` | No | shared alt-text prompt | Prompt sent with the image. |

### Rate Limiting, Logging, and Swagger

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate-limit window. |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window. |
| `RATE_LIMIT_STORE` | No | `auto` | Rate-limit storage mode: `auto`, `memory`, or `redis`. `auto` promotes to Redis when `RATE_LIMIT_REDIS_URL` or `REDIS_URL` is set. |
| `RATE_LIMIT_REDIS_TOPOLOGY` | No | `external` | Redis deployment topology. `external` expects `RATE_LIMIT_REDIS_URL`/`REDIS_URL`; `unit-local` defaults Redis to `redis://127.0.0.1:6379` for future Docker/Pod-local sidecars. |
| `RATE_LIMIT_REDIS_URL` | No | unset | Explicit Redis URL for the shared rate-limit store. Takes precedence over `REDIS_URL`. |
| `RATE_LIMIT_REDIS_PREFIX` | No | `alt-text-generator:rate-limit:` | Redis key prefix for rate-limit buckets. |
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
- Clustered mode (`WORKER_COUNT > 1`) requires a Redis-backed limiter. Startup validation fails fast if clustered mode is enabled without `RATE_LIMIT_STORE=redis|auto` and a resolvable Redis endpoint.
- The current Render deployment runs the `external` topology — it does not set `RATE_LIMIT_REDIS_TOPOLOGY` at all, and `external` is the code default (`config/rateLimitStore.js`) — so the future pod-local Redis path is inactive for now.
- Horizontal instance scaling should use an external/shared Redis-backed limiter, and `STATUS_RATE_LIMIT_MAX` should be sized for the aggregate health-probe budget across instances.
- The future `RATE_LIMIT_REDIS_TOPOLOGY=unit-local` mode is meant for a Docker/Kubernetes-style resilient unit where several worker processes intentionally share one pod-local Redis instance.
- Redis-backed limiter errors fail open at request time to preserve availability, but startup still fails fast when Redis is explicitly required and unreachable during bootstrap.
- Auth-protected API failures use a structured JSON contract with `error`, `code`, `requestId`, and optional `details`.

## Render Deployment Contract

- [`render.yaml`](./render.yaml) is a **reference manifest, not applied configuration.** No Blueprint is registered for this account and the service predates the file, so nothing syncs it: editing `render.yaml` changes nothing on the running service. It exists to document the intended shape and to rebuild the service if it ever has to be recreated. The **Render dashboard is the source of truth for environment variables** — read it there, not here.
- The service *shape* does match the manifest: plan `free`, region `oregon`, `numInstances: 1`, health check `/api/health`, build `npm ci`, start `npm run prod`, runtime `node`, branch `production`, auto-deploy on commit. The environment differs by design — the dashboard also carries the provider credentials, which the manifest does not represent.
- Render reads the Node runtime version from [`package.json`](./package.json) `engines.node`.
- Render builds with `npm ci` so production installs are lockfile-exact and reproducible; never revert to `npm install` except as a temporary escape hatch while repairing a broken lockfile.
- Secrets such as `REPLICATE_API_TOKEN` stay dashboard-managed; the manifest lists them with `sync: false` so it never carries a value.
- Inbound TLS terminates at Render's edge, so the service runs with `TLS_ENABLED=false` and serves HTTP-only on `PORT`, which is pinned explicitly to `8080` on the dashboard rather than left to Render's injected default. `TLS_KEY`/`TLS_CERT` are therefore not required on the service — `validateEnvVars` asks for them only when TLS is actually enabled. This is a deliberate edge-termination choice, not a downgrade of the project's HTTPS-first default — see [Inbound TLS posture](#inbound-tls-posture-https-first-vs-edge-termination). Public traffic stays HTTPS via the edge certificate.
- Set `TRUST_PROXY_HOPS=1` explicitly on the service (Render is a single ingress hop) so `req.secure`, the HTTP→HTTPS redirect, secure cookies, and HSTS remain correct behind the edge. Raise it if a further proxy/CDN is added in front.

### Deployment evidence and rollback

- Promotion creates a GitHub Deployment (environment `production`) recording the promotion mode, source/target SHAs, and the required checks it verified; post-deploy verification marks it `success`/`failure` with run and environment URLs. Inspect with `gh api repos/jsugg/alt-text-generator/deployments --jq 'map(select(.environment=="production"))[:5]'`.
- Rollback is manual and dry-run-first: dispatch the `Rollback Production` workflow with the previous known-good production SHA (promotion prints it as `Target SHA before`), a reason, and `dry_run=true`; re-dispatch with `dry_run=false` only after the printed plan is confirmed. The workflow uses the repository automation GitHub App (same trust boundary as promotion), shares the promotion concurrency group so releases and rollbacks never interleave, and records a rollback deployment. Render redeploys the rollback commit from the production push and post-deploy verification sets the final status.
- Platform-native rollback (fastest recovery): dispatch the `Rollback Render Service` workflow with an optional `to_deploy_id` (blank picks the most recent successful deploy), a reason, and `dry_run=true` first. It redeploys a previous known-good Render deploy through the Render API, so it restores service instantly and does not depend on force-moving the protected `production` ref. It needs the `RENDER_API_KEY` secret and `RENDER_SERVICE_ID` variable on the `prod-validation` environment. Realign the `production` git ref separately once the incident is contained. Prefer this over `Rollback Production` when a branch ruleset blocks the git rollback or when speed matters.
- Free-tier pre-warm: `scripts/render/prewarm-service.sh` best-effort pings the production health endpoint to reduce cold-start when a deploy provisions. It runs only on genuine events — at the start of `Promote to Production` and both rollback workflows, and on every push to `main` (`Warm Production On Merge`) — never on a fixed schedule, so it reads as organic traffic rather than an anti-hibernation keep-alive cron. Override the target with the `PRODUCTION_HEALTH_URL` variable; it never fails its job.
- Automated rollback stays deferred until a manual rollback drill has passed, failure classification can distinguish a deploy regression from a transient provider outage, and the blast radius is accepted.

## Quality Gates

Run these before pushing:

```bash
npm run validate:fast
NODE_ENV=test REPLICATE_API_TOKEN=test-token npm run test:integration
NODE_ENV=test REPLICATE_API_TOKEN=test-token npm run test:integration:scripts
npm ci --dry-run
```

`npm run lint` fails on any ESLint warning (`--max-warnings=0`), so local lint output must stay clean.

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
| Replicate execution | `GET /api/accessibility/description?...&model=replicate` | `200` with non-empty description or `202` with a job payload | vendor account / model execution |
| Azure execution | `GET /api/accessibility/description?...&model=azure` | `200` with non-empty description | Azure credentials / model execution |
| Page orchestration | `GET /api/accessibility/descriptions?...&model=replicate` | `200` with ordered `descriptions` array or `202` with a page-job payload | orchestration / provider reuse |

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
curl -sk 'https://localhost:8443/api/accessibility/description?image_source=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F1x%2Fgooglelogo_color_272x92dp.png&model=replicate'
```

If the response is `202 Accepted`, poll the returned `statusUrl` until it becomes `200`:

```bash
curl -sk 'https://localhost:8443/api/accessibility/description-jobs/<job-id>'
```

6. If Azure is configured, validate the Azure provider through the app:

```bash
curl -sk 'https://localhost:8443/api/accessibility/description?image_source=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F1x%2Fgooglelogo_color_272x92dp.png&model=azure'
```

7. Validate the page-level orchestration route:

```bash
curl -sk 'https://localhost:8443/api/accessibility/descriptions?url=https%3A%2F%2Fdeveloper.chrome.com%2F&model=replicate'
```

If the response is `202 Accepted`, poll the returned `statusUrl` until it becomes `200`:

```bash
curl -sk 'https://localhost:8443/api/accessibility/page-description-jobs/<job-id>'
```

Expected properties:

- `descriptions` preserves duplicate image entries in page order
- `uniqueImages` is less than or equal to `totalImages`
- duplicate `imageUrl` values reuse the same description content in the response

8. Capture evidence from the HTTP response and the app log (to separate app defects from vendor failures).

### Interpreting failures (common)

- `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
  - outbound trust-store problem for the current Node runtime
- `403` from the target site
  - the remote site is blocking or rejecting the scraper request
- `402 Payment Required` from Replicate
  - valid API path, but the account lacks credit
- `429 Too Many Requests` from Replicate
  - valid API path, but the account is throttled
- local `504 DESCRIPTION_PROVIDER_TIMEOUT`
  - provider execution exceeded the app deadline; use the async job path or raise the timeout only with clear justification
- local `500` with no upstream HTTP response
  - likely application bug or unhandled runtime issue

### Deterministic validation without vendor spend

For deterministic local testing or CI-like validation, point the app at a local fixture-backed provider:

```bash
REPLICATE_API_ENDPOINT=http://127.0.0.1:19090 REPLICATE_API_TOKEN=test-token node src/app.js
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
- Redis-backed shared rate limiting is the supported production shape for clustered or horizontally scaled deployments.
- Future pod-local Redis support is feature-flagged through `RATE_LIMIT_REDIS_TOPOLOGY=unit-local`; keep it disabled on the current Render web service until the runtime unit itself owns that Redis process.
- Express trusts `TRUST_PROXY_HOPS` forwarded proxy hops, which defaults to `1` to match the current Render ingress layout.

## Keeping This Doc Correct

If you change configuration, update these together:

- `config/index.js` (defaults and wiring)
- `src/providers/definitions/*` and `config/providerCatalog.js` (provider defaults, env schema, and registration)
- `config/providers.yaml` (provider enable/disable overrides)
- `src/utils/validateEnvVars.js` (startup contract)
- `render.yaml` (Render deployment contract)
- `.env.example` (sample environment)
- this file (developer-facing reference and runbook)
