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
| `strict: true` — current (after burn-down log below) | 1372 |
| `strict: false` (reference only) | 170 |

## Burn-down log

| Date | Scope | Cleared | Method |
|---|---|---:|---|
| 2026-07-02 | `scripts/github/verify-required-checks.js` | 15 → 0 | JSDoc `@param`/`@typedef` + type-only boundary casts at the JSON/gh-API edges. No runtime change, no `any`. **Pattern for the rest:** annotate params, `@typedef` external-JSON response shapes, and cast once at the validation boundary — never widen the strict profile. |
| 2026-07-02 | `tsconfig.checkjs.json` — add `DOM` to `lib` | 34 → 0 | Declares Node's global `fetch`/`Response`/`Headers` (real at the Node 24 runtime), clearing `Cannot find name 'fetch'` repo-wide. No dependency change; no strictness change. |
| 2026-07-02 | `scripts/github/{compose-pages-site,write-newman-summary,sync-pages-state-branch,resolve-pages-source-run}.js` | 14 → 0 | Typed the `parseArgs` arg-object locals + non-optional return shapes; cast `filter(Boolean)` / JSON boundaries. Only runtime change: `compose-pages-site` `publishPath` now defaults to `''` not `null` (strictly safer). |

Top strict-error areas (pre-burn-down baseline; `scripts/github` now ≈127):

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
