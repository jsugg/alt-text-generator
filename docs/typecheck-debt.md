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
| `strict: true` — current (after burn-down log below) | 823 |
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
| 2026-07-03 | `src/services/PageDescriptionJobService.js` | 65 → 0 | Sibling of DescriptionJobService: `@typedef` `PageJob`/`DescriptionJob`/`JobStore`/`Logger`/`PageDescriptionServiceLike`/`DescriptionJobServiceLike`/`PageResolveResult`; cast the optional `descriptionJobService` once at the resolver boundary; typed the inner recursive `waitForTerminalDescriptionJob` arrow; `replace_all` the `this.constructor` static casts (`buildExpirationIso` ×4, `buildJobError` ×2); `Error & { code }` casts in the job-error builders; `buildFailedJob` takes `unknown` + internal cast. No runtime change; 13 related unit tests green. |
| 2026-07-03 | `src/services/{Azure,Ollama,Scraper}Service.js` | 35 → 0 | **`src/services` area now 0** (from 273 baseline). Per-file `Logger`/`HttpClient`/`ProviderConfig`/`RequestOptions` typedefs; `AzureError` shape cast for the axios-error skip-check; type-only `this.constructor` casts; `URLSearchParams.set` / `new URL` arg casts (constructor-guaranteed non-null endpoint); `Scraper` `images` accumulator cast + `(value:any)=>Promise<URL>` outbound-policy type. No runtime change; 31 related unit tests green. |
| 2026-07-03 | `src/infrastructure/descriptionJobStore.js` | 32 → 0 | The concrete `JobStore` (in-memory + Redis): `@typedef` `StoredJob`/`RedisClient`/`RedisTransaction`/`DescriptionJobsConfig`; annotate module helpers + both stores' methods (4-space indent distinguishes the returned Redis object's methods from the class's); double-cast the real `redis` client → loose `RedisClient` at the boundary (avoids fighting the generic redis types); typed the `initialize` options object so the destructuring-default stops hiding `config`/`logger`. No runtime change; 6 related unit tests green. |
| 2026-07-03 | `src/providers/definitions/{buildOpenAiCompatibleProvider,helpers}.js` | 41 → 0 | Provider-definition builder + shared helpers: `OpenAiCompatibleProviderOptions` typedef for the options bag; typed the inner `buildEnvSchema`/`buildConfig`/`isConfiguredInConfig`/`createRuntime` arrows; cast the runtime ctor arg via `ConstructorParameters<typeof Service>[0]` (the collaborator's param types are file-local); **root-caused** the `never[]` errors to `helpers.js`'s `dependentEnvNames = []` default — typed `validateApiKeyBackedProviderEnv` (+ the other helpers) so `dependentEnvNames` is `string[]`. No runtime change; 51 related provider unit tests green. |
| 2026-07-03 | `src/api/v1/controllers/descriptionController.js` | 33 → 0 | Express controller: minimal duck-typed collaborators (factory + 3 service-likes) and `ControllerRequest`/`ControllerResponse` (query/params as `Record<string,string>`, chainable `res`); `@param` appended to each handler's existing `@swagger` block; `replace_all` the two uniform catch-error casts (`error.message` → `(Error)`, `cause: error` → `(object)`). No runtime change; 24 related controller unit tests green. |
| 2026-07-03 | `src/infrastructure/{rateLimitStore,logger,loadTlsCredentials,outboundTrust}.js` | 55 → 0 | **`src/infrastructure` area now 0** (from 112 baseline). rateLimitStore: store/config/provider typedefs, `@type` on the fail-open store literal, closure casts for `store.get`/`store.resetAll` (property narrowing dies at fn boundaries), `init` param `any` (index signatures don't satisfy express-rate-limit's required `Options` props). logger: pino/pino-http ship ESM-shaped types — double-cast the requires to `default & namespace` once; `Parameters<typeof stdSerializers.x>[0]` mirrors the serializer inputs; explicit `@returns` breaks the recursive-serializer TS7023; pino-http's `http` augmentation types `req.id`. loadTlsCredentials: `SelfsignedModule` typedef + cast at the lazy require (assigning `any` doesn't narrow). outboundTrust: undici `RequestInfo`/`RequestInit`. No runtime change; 41 infrastructure unit suites green (verifier-lite). |
| 2026-07-03 | `src/infrastructure/outboundUrlPolicy.js` | 25 → 0 | SSRF policy module: `@param {string}` the IP/hostname helpers, `@param {unknown}` at the URL/host validation boundaries; `DnsLookupFn` typedef (loose `{ address?: unknown }` records so the real `dns.promises.lookup` and injected fakes both fit); `PolicyHttpResponse` (`& Record<string, any>` so axios-shaped consumers keep flowing) + `PolicyRequestFn` typedefs; `filter(Boolean)` and `Set.has(string \| null)` casts; `Number.isInteger` ternary cast for `maxRedirects`. No runtime change; 14 related unit tests green. |

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
