# Typecheck debt ledger

`npm run typecheck` runs strict JSDoc type checking (`tsconfig.checkjs.json`:
`checkJs` + `strict`, TypeScript 6) over `src/`, `config/`, and `scripts/`.
The CI `typecheck` job is **advisory** (`continue-on-error: true`) until this
ledger reaches zero; it is intentionally not a required status check.

Owner: @jsugg. Baseline measured 2026-07-02 (TypeScript 6.0.3).

| Profile | Errors |
|---|---:|
| `strict: true` (committed config, target) | 1409 |
| `strict: false` (reference only) | 170 |

Top strict-error areas:

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
