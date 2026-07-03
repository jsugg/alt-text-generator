# Typecheck debt ledger

`npm run typecheck` runs strict JSDoc type checking (`tsconfig.checkjs.json`:
`checkJs` + `strict`, TypeScript 6) over `src/`, `config/`, and `scripts/`.
The CI `typecheck` job is **advisory** (`continue-on-error: true`) until this
ledger reaches zero; it is intentionally not a required status check.

Owner: @jsugg. Baseline measured 2026-07-02 (TypeScript 6.0.3). The count drifts
with dependency updates — re-measure (`npm run typecheck`) before each burn-down.

| Profile | Errors |
|---|---:|
| `strict: true` — original baseline 2026-07-02 | 1409 |
| `strict: true` — measured 2026-07-02 (dependency drift) | 1438 |
| `strict: true` — current (after burn-down log below) | 1104 |
| `strict: false` (reference only) | 170 |

## Burn-down log

| Date | Scope | Cleared | Method |
|---|---|---:|---|
| 2026-07-02 | `scripts/github/verify-required-checks.js` | 15 → 0 | JSDoc `@param`/`@typedef` + type-only boundary casts at the JSON/gh-API edges. No runtime change, no `any`. **Pattern for the rest:** annotate params, `@typedef` external-JSON response shapes, and cast once at the validation boundary — never widen the strict profile. |
| 2026-07-02 | `tsconfig.checkjs.json` — add `DOM` to `lib` | 34 → 0 | Declares Node's global `fetch`/`Response`/`Headers` (real at the Node 24 runtime), clearing `Cannot find name 'fetch'` repo-wide. No dependency change; no strictness change. |
| 2026-07-02 | `scripts/github/{compose-pages-site,write-newman-summary,sync-pages-state-branch,resolve-pages-source-run}.js` | 14 → 0 | Typed the `parseArgs` arg-object locals + non-optional return shapes; cast `filter(Boolean)` / JSON boundaries. Only runtime change: `compose-pages-site` `publishPath` now defaults to `''` not `null` (strictly safer). |
| 2026-07-02 | `config/{index,providerOverrides}.js`, `src/errors/ProviderTimeoutError.js`, `src/providers/definitions/openrouter.js` | 12 → 0 | `@param {unknown}` on the env coercion / arg helpers; `import('joi').Root` + env callback types; boundary casts (`mapping`/`config`) on the parsed-YAML object to avoid cascading `TS2339`. No runtime change. |
| 2026-07-02 | `scripts/github/review-dependencies.js` | 49 → 0 | `@typedef` the dependency-graph compare API model (`DependencyChange`/`Vulnerability`/`VulnerableChange`) and CLI `ParsedArgs`/`ValidatedArgs`; type each helper's params/returns; cast the arg-object literal and cast once at the `parseArgs` validation boundary (→ `ValidatedArgs`). No runtime change; 23 related unit tests green. |
| 2026-07-03 | `scripts/github/create-github-app-installation-token.js` | 34 → 0 | Same shape: `ParsedArgs`/`ValidatedArgs` for the CLI args, `InstallationLookupResponse`/`InstallationTokenResponse` for the App API; `fetchGitHubJson` returns `unknown` and each caller casts at the boundary; `Record<string,string>` header map for the conditional `Content-Type`. No runtime change; 12 related unit tests green. |
| 2026-07-03 | `src/services/PageDescriptionService.js` | 47 → 0 | `@typedef` the duck-typed collaborators (`Describer`/`AsyncDescriber`/`ScraperService`/`ImageDescriberFactory`) and domain shapes (`ImageDescription`/`ProviderJob`/`SettledDescription`); made `supportsAsyncJobs` a type-predicate (`x is AsyncDescriber`) so the async-only methods narrow; `@template` on the concurrency mapper; type-only cast of `this.constructor` (→ `typeof PageDescriptionService`) to keep dynamic dispatch. No runtime change; 8 related unit tests green. |
| 2026-07-03 | `src/services/DescriptionJobService.js` | 42 → 0 | `@typedef` the job model (`Job`/`JobSeed`/`JobError`/`ProviderJob`) and collaborators (`Describer`/`JobStore`/`ImageDescriberFactory`); `ResolveDescriptionResult` union for the resolver; typed `now`/`sleep` constructor deps; `this.constructor` static-access casts (`replace_all` for the 4 `buildExpirationIso` calls) and one `providerJobId` boundary cast in `refreshJob`. No runtime change; 7 related unit tests green. |
| 2026-07-03 | `src/services/OpenAiCompatibleVisionDescriberService.js` | 42 → 0 | `@typedef` collaborators (`Logger`/`HttpClient`/`ProviderConfig`/`RequestOptions`/`ImageAsset`) and axios-style `HttpError`; error helpers take `@param {unknown}` and cast to `HttpError` internally so `unknown` catch-vars flow without caller changes; added the undocumented `sleep` constructor dep; type-only `this.constructor` cast; `Set.has` args cast where the value is `\| undefined \| null`. No runtime change; 6 related unit tests green. |
| 2026-07-03 | `src/services/ReplicateDescriberService.js` | 42 → 0 | `@typedef` `Logger`/`ProviderConfig`/`RequestOptions`/`Prediction`/`ReplicateClient`/`ProviderJob`; typed the SDK-shaped `predictions.{create,get,cancel}` client; `replace_all` the 3 `this.constructor.normalizePrediction` static-access casts; boundary-cast the `unknown` error message. No runtime change; 4 related unit tests green. |

Top strict-error areas (pre-burn-down baseline; `scripts/github` now ≈42):

| Area | Errors |
|---|---:|
| `src/services` | 273 |
| `scripts/postman` | 185 |
| `scripts/github` | 142 |
| `src/providers` | 112 |
| `src/infrastructure` | 112 |
| `src/api` | 87 |
| `src/server` | 82 |
| `scripts/run-postman-harness.js` | 68 |
| `scripts/openapi` | 64 |
| `scripts/perf` | 45 |

## Promotion criteria (advisory → required)

1. `npm run typecheck` exits 0 on `main`.
2. Remove `continue-on-error: true` from the CI `typecheck` job (update the
   `jestLaneConfigs` invariant in the same PR).
3. Add `typecheck` to `config/github/required-checks.json` contexts and patch
   live branch protection per `docs/required-checks.md`.

Burn down by area (highest counts first); do not weaken the committed strict
profile to make the number smaller — the strict profile is the target the
editor `config/jsconfig.json` already assumes.
