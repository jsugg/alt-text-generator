# Dependency security — transitive vulnerabilities

How this repo handles vulnerabilities that live **deep in a dependency tree**,
where the vulnerable package is not a direct dependency and the tool that pulls
it in has no non-breaking upgrade.

## Posture

Upgrade direct tools to their latest supported releases first. Where an
up-to-date parent still resolves a vulnerable transitive package, use a narrow
`overrides` range only when the patched package preserves the API that parent
uses, then verify the affected runner end to end. `npm audit fix --force` is not
used: npm currently proposes downgrading Jest and Newman to obsolete releases,
which would weaken rather than secure required CI lanes.

## What is pinned

`package.json` → `overrides` forces these dev/test-only transitive packages to
patched releases. They arrive through Jest coverage/reporting and Newman:

<!-- generated:overrides start -->
| Override | Fixes |
|---|---|
| `babel-plugin-istanbul → ^8.0.0` | Jest coverage's legacy `test-exclude` / `glob` vulnerability chain |
| `handlebars → ^4.7.9` | **critical** AST-injection / prototype-pollution chain |
| `flatted → ^3.4.2` | prototype pollution + unbounded-recursion DoS |
| `newman>jose → 4.15.9` | Newman's Postman runtime JWE resource-exhaustion advisory |
| `lodash → ^4.18.1` | code-injection + prototype-pollution advisories |
| `minimatch@>=9 <10.2.6 → ^10.2.6` | Jest's `glob@10` brace-expansion OOM advisory |
| `node-forge → ^1.4.0` | signature/verification advisories |
| `qs → ^6.15.3` | transitive `qs` (the direct dep is already ≥ 6.15.3) |
| `underscore → ^1.13.8` | arbitrary code execution |
| `newman>uuid → 11.1.1` | Newman's Postman UUID buffer-bounds advisory |
<!-- generated:overrides end -->

Override scopes target vulnerable version ranges or parent dependency trees.
Replacements stay within the CommonJS/API shapes consumed by Jest and Newman;
they are removed once upstream dependency ranges resolve patched releases
directly.

## Accepted residual

None. Full production and development dependency trees audit clean.

<!-- generated:accepted start -->

<!-- generated:accepted end -->

## Verifying

The tables above are **generated** from
[`config/security/residual-advisories.json`](../config/security/residual-advisories.json).
Edit the manifest, then run `npm run security:docs -- --write`. The `docs` gate
fails if this document and the manifest disagree, and if the manifest's override
list and `package.json`'s do.

<!-- generated:verified start -->
Last verified against a full-tree `npm audit`: **2026-08-10**.

Lockfile at that time: `b4bc4c3a6286e48d2206127603661dc113c67ccfa9512b251a557011509b6e55`

When `package-lock.json` changes, this stops matching — which is the signal
to re-verify and update `config/security/residual-advisories.json`.
<!-- generated:verified end -->

`Dependency Residual Audit` runs a **full-tree** `npm audit` weekly and compares
it to the manifest, reporting any advisory that is not approved, and any
approved entry that upstream has since fixed. It is **non-blocking**: the
advisory database changes without anyone touching this repo, and a required
check must not go red because a third party published overnight.

The always-required scheduled `npm-audit` job remains production-focused with
`--omit=dev`. Dependency-changing pull requests also audit the full tree so a
high/critical development-tool regression cannot merge unnoticed.
