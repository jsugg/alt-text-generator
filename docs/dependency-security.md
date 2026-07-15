# Dependency security — transitive vulnerabilities

How this repo handles vulnerabilities that live **deep in a dependency tree**,
where the vulnerable package is not a direct dependency and the tool that pulls
it in has no non-breaking upgrade.

## Posture

Fix the vulnerable **leaf** package with an `overrides` pin to a patched
version — do **not** force-upgrade the parent tool across a major version just
to chase a transitive advisory. `npm audit fix --force` is not used here: for
this tree it wants to install `newman@2.1.2` (a five-year-old downgrade of the
Postman test runner) and `jest-junit@17` (a breaking reporter change), which
would take out required CI lanes to fix **dev-only** advisories.

## What is pinned

`package.json` → `overrides` forces these transitively-pulled packages up to
their patched releases. All are dev/test-only (they arrive via `newman`, the
Postman CLI used in the test harness):

<!-- generated:overrides start -->
| Override | Fixes |
|---|---|
| `handlebars ^4.7.9` | **critical** AST-injection / prototype-pollution chain |
| `lodash ^4.18.1` | code-injection + prototype-pollution advisories |
| `node-forge ^1.4.0` | signature/verification advisories |
| `underscore ^1.13.8` | arbitrary code execution |
| `flatted ^3.4.2` | prototype pollution + unbounded-recursion DoS |
| `qs ^6.15.3` | transitive `qs` (the direct dep is already ≥ 6.15.3) |
<!-- generated:overrides end -->

Caret ranges (not exact pins) so patch/minor fixes still flow; these entries are
removed once the upstream `newman` tree ships the patched versions itself.

## Accepted residual

The remaining advisories are **all moderate, all dev/test-only**, and every
available fix is a breaking major bump into a consumer that expects the old API:

<!-- generated:accepted start -->
- **`uuid`** (Missing buffer bounds check in v3/v5/v6 when buf is provided, GHSA-w5hq-g745-h8pq) — pulled by `jest-junit`, `postman-collection`, `postman-request`, `serialised-error`. The fix is uuid@14, whose ESM/named-export API breaks those old consumers.
- **`jose`** (Resource exhaustion via a crafted JWE with compressed plaintext, GHSA-hhhv-q57g-882q) — pulled by `postman-runtime`. The fix is jose@6, two majors past what postman-runtime targets.
<!-- generated:accepted end -->

Neither is reachable from the production runtime (`src/`). They are tolerated
until `newman` / `jest-junit` update their own trees, at which point the
`npm ci` lockfile refresh clears them with no action here. Do **not** force
these with `overrides` — it breaks the Postman harness and the JUnit reporter,
both of which are required CI.

## Verifying

The tables above are **generated** from
[`config/security/residual-advisories.json`](../config/security/residual-advisories.json).
Edit the manifest, then run `npm run security:docs -- --write`. The `docs` gate
fails if this document and the manifest disagree, and if the manifest's override
list and `package.json`'s do.

<!-- generated:verified start -->
Last verified against a full-tree `npm audit`: **2026-07-15**.

Lockfile at that time: `9aa20c19d81ca2ec83bdaf7b02b80fd7af493e469de194e7a0e1e9926d6c2fdc`

When `package-lock.json` changes, this stops matching — which is the signal
to re-verify and update `config/security/residual-advisories.json`.
<!-- generated:verified end -->

`Dependency Residual Audit` runs a **full-tree** `npm audit` weekly and compares
it to the manifest, reporting any advisory that is not approved, and any
approved entry that upstream has since fixed. It is **non-blocking**: the
advisory database changes without anyone touching this repo, and a required
check must not go red because a third party published overnight.

The always-required `npm-audit` job stays `--omit=dev --audit-level=high`, which
is the right gate for *production* risk — and the reason this document needed
its own: `--omit=dev` cannot see any of the advisories above, and
`--audit-level=high` would not report them if it could. A regression that
reintroduces a high/critical, or that force-downgrades `newman`, should still
fail review.
