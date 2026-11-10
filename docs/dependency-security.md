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
| `handlebars → ^4.7.10` | **critical** AST type-confusion / own-property-check JavaScript-injection chain |
| `flatted → ^3.4.2` | prototype pollution + unbounded-recursion DoS |
| `newman>jose → 4.15.9` | Newman's Postman runtime JWE resource-exhaustion advisory |
| `newman>postman-collection>@faker-js/faker → $@faker-js/faker` | **high** GHSA-qxc2-j82w-r537: replaces faker with the fail-closed `tools/faker-stub` (Postman dynamic variables are banned by `postman:lint`) |
| `lodash → ^4.18.1` | code-injection + prototype-pollution advisories |
| `minimatch@>=9 <10.2.6 → ^10.2.6` | Jest's `glob@10` brace-expansion OOM advisory |
| `markdownlint-cli2>markdownlint → 0.42.1` | `markdownlint@0.42.0`'s exact `re2js@2.8.6` lookbehind ReDoS; 0.42.1 is upstream's own `re2js@2.9.1` fix |
| `node-forge → ^1.4.3` | signature/verification, PEM ReDoS, and TLS record-processing DoS advisories |
| `qs → ^6.17.1` | transitive `qs` (the direct dep is already ≥ 6.17.1) |
| `test-exclude → ^8.0.0` | keeps Jest coverage on `glob@13` / `minimatch@10`; `test-exclude@7` nests `glob@10`, where npm 10 skips the minimatch override (Node 22 `npm ci`). Same `index.js` as 7.0.2 |
| `underscore → ^1.13.8` | arbitrary code execution |
| `newman>uuid → 11.1.1` | Newman's Postman UUID buffer-bounds advisory |
<!-- generated:overrides end -->

One override replaces a package instead of patching it. Every
`postman-collection` release pins `@faker-js/faker@5.5.3`
(GHSA-qxc2-j82w-r537), and the fixed faker is an incompatible rewrite.
`postman-collection` uses faker only for Postman `{{$random*}}` dynamic
variables, which this repository does not use. So `newman>postman-collection`
resolves faker to `tools/faker-stub`, a dependency-free local package (a
`file:` dev dependency referenced as `$@faker-js/faker`) whose every call
throws. `postman:lint` rejects any `{{$...}}` token and any `replaceIn` in
`postman/**/*.json`: postman-sandbox's prebuilt bootcode bundles its own faker,
reachable only through `pm.variables.replaceIn`. Retire the stub when Newman
leaves this repository.

Override scopes target vulnerable version ranges or parent dependency trees.
Replacements stay within the CommonJS/API shapes consumed by Jest and Newman;
they are removed once upstream dependency ranges resolve patched releases
directly.

## Accepted residual

None. Neither the production nor the full dependency tree has high or critical
advisories; lower-severity findings are summarized by the scheduled
`Dependency Residual Audit` below. Any future entry needs an `expires` date.

<!-- generated:accepted start -->

<!-- generated:accepted end -->

## Verifying

The tables above are **generated** from
[`config/security/residual-advisories.json`](../config/security/residual-advisories.json).
Edit the manifest, then run `npm run security:docs -- --write`. The `docs` gate
fails if this document and the manifest disagree, and if the manifest's override
list and `package.json`'s do.

<!-- generated:verified start -->
Last verified against a full-tree `npm audit`: **2026-11-10**.

Lockfile at that time: `9a9e99e832f26890d969bb8f9f4b6299a2f095ba715572c4a443907e8b14a223`

When `package-lock.json` changes, this stops matching — which is the signal
to re-verify and update `config/security/residual-advisories.json`.
<!-- generated:verified end -->

`Dependency Residual Audit` (`.github/workflows/dependency-residual-audit.yml`,
weekly and on manual dispatch) runs a **full-tree** `npm audit` and compares it
to the manifest. It is **blocking**, and it fails on:

- any **unapproved high or critical** advisory, and
- any **accepted entry that is no longer reported** (remove it).

Unapproved moderate and low advisories appear in the job summary but do not
fail it, so an overnight low-severity publication never turns a required check
red. The pull-request `dependency-audit` check (a required check) applies the
same comparison to its own full-tree report whenever npm dependency inputs or
this audit policy change.

An accepted entry must carry an `expires` date. It renders above as `Expiry:`,
and the `docs` gate fails once that date passes, so every acceptance is
time-boxed. Accepted entries are development-only by schema
(`productionReachable: false`).

`Security Audit` is production-only: its `npm-audit` job stays `--omit=dev
--audit-level=high` and fails on any high or critical production finding,
with no accepted exceptions.
