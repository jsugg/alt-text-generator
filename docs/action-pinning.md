# GitHub Actions pinning policy

**Third-party actions must be pinned to a full-length commit SHA. First-party
`actions/*` and `github/*` actions may be referenced by tag (trusted by
publisher).** You pin what you reference; you do not try to pin what GitHub
nests inside its own actions.

## Why this shape

SHA-pinning defends against tag mutation — the class of attack where a popular
action's tag is repointed at malicious code (e.g. the `tj-actions/changed-files`
compromise). The threat is real for **third-party** actions, so those are pinned
to an immutable commit.

The repo previously enforced this with the runner-level setting
`sha_pinning_required`, which also validated **transitive** references — the
`uses:` lines *inside* the actions we call. GitHub's own actions reference their
dependencies by tag (`actions/upload-pages-artifact@v3` calls
`actions/upload-artifact@v4` internally), so that setting rejected the Pages
publish at "Set up job" and would break any future first-party toolchain the
same way. See [allure-pages] history.

We resolve the clash by enforcing pinning at the layer we actually control —
our own direct `uses:` — and trusting GitHub as a publisher for `actions/*` and
`github/*`. This is the OpenSSF "pin what you use" guidance: pin third-party to
a SHA, trust the platform for what it nests.

## How it is enforced

- **`scripts/github/verify-action-pins.js`** classifies every `uses:` in
  `.github/workflows/*.yml` and `.github/actions/**/action.yml`. Run locally
  with `npm run verify:action-pins`.
- **`tests/unit/scripts/github/actionPinPolicy.test.js`** asserts the policy has
  zero violations. It runs in the required `test:unit` / `test:ci` lanes, so an
  unpinned third-party action fails a **required** check on the PR — the gate
  binds without a new branch-protection context.

Local composite actions (`./…`) and `docker://` images are out of scope for this
check (the former is our own code; container images are pinned separately).

## Trusted publishers

| Publisher | Referenced by | Rationale |
|---|---|---|
| `actions/*` | tag or SHA | GitHub-authored; internals are GitHub's to pin. |
| `github/*` | tag or SHA | GitHub-authored (e.g. `github/codeql-action`). |

Every other publisher must pin to a commit SHA. There are currently no
third-party exceptions — both third-party actions in use
(`EnricoMi/publish-unit-test-result-action`, `step-security/harden-runner`) are
SHA-pinned. To add a publisher to the trusted set, edit `TRUSTED_PUBLISHERS` in
the verifier and record the rationale here.

## Keeping pins current

A pin with no update pipeline rots into a stale, vulnerable version. Dependabot
(`github-actions` ecosystem, weekly) bumps the SHA pins and keeps the readable
`# vX.Y.Z` comment. Never hand-freeze an action without letting Dependabot track
it.

## Relationship to `sha_pinning_required`

The runner-level `sha_pinning_required` is intentionally **off**: it over-reached
by policing GitHub's transitive references. Enforcement now lives in CI (the
policy test above). If the setting is ever re-enabled, the Pages publish will
break again at "Set up job" — that is the expected symptom, not a regression.

[allure-pages]: ../.github/workflows/allure-pages-publish.yml
