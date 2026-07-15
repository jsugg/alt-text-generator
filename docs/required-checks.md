# Required status checks — policy, verification, and migration

`config/github/required-checks.json` is the single source of truth for the
required status checks on the `main` branch protection and the `production`
repository ruleset (`13764136`). Every context in that file must exactly match
a workflow job display name; GitHub matches required checks by name, so a job
rename silently breaks the gate.

## Verification

| Command | Scope |
|---|---|
| `npm run checks:verify` | Offline: policy vs workflow job names, retired-name patterns, duplicates, and the promotion workflow's check list. Runs in unit tests too (`tests/unit/scripts/github/requiredCheckPolicy.test.js`). |
| `npm run checks:verify -- --live` | Adds live GitHub verification: `main` branch protection contexts, production ruleset contexts, and ruleset bypass actors. Requires a `gh` login with admin read access; run manually, not in CI. |

## Live-state export (before any policy mutation)

Export and keep the current state before changing branch protection, rulesets,
or repository settings. Store the exports in a gitignored directory or outside
the repository entirely:

```bash
gh api repos/jsugg/alt-text-generator/branches/main/protection > main-protection.json
gh api repos/jsugg/alt-text-generator/rulesets/13764136 > production-ruleset.json
gh api repos/jsugg/alt-text-generator/environments > environments.json
gh api repos/jsugg/alt-text-generator/actions/permissions > actions-permissions.json
```

## Migration staging (Node 24 cutover)

1. Add the new Node 24 gate (`test:ci (24)`) while the Node 20 gate still
   exists; merge; then add the new context to live required checks.
2. Only during the cutover window: remove Node 20 contexts from live
   protection, then merge the workflow change that removes the Node 20 jobs.
3. Patch the production ruleset to mirror the final release policy in the same
   window; re-export both JSON states afterwards.
4. Update `config/github/required-checks.json` in the same PR as the workflow
   change so offline verification stays green at every step.

## Rollback

Reapply the exported JSON if a patch locks a branch or blocks promotion:

```bash
gh api -X PUT repos/jsugg/alt-text-generator/branches/main/protection/required_status_checks/contexts \
  --input restored-contexts.json
gh api -X PUT repos/jsugg/alt-text-generator/rulesets/13764136 --input production-ruleset.json
```

## Production ruleset bypass actors

| Actor | Mode | Rationale |
|---|---|---|
| `RepositoryRole/5` (admin) | always | Admin break-glass on a single-maintainer repository. |
| `Integration/3062508` | always | Repository tooling GitHub App (`REPO_TOOLING_GITHUB_APP_ID`); `promote-to-production` uses it to update the protected `production` ref. |

Any other bypass actor is unintended; `npm run checks:verify -- --live` fails
if the live bypass list drifts from the policy file.
