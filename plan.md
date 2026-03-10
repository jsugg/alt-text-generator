# CI / Newman Improvement Plan

This document captures the next tranche of improvements for the Postman/Newman and CI workflow stack.

## Goal

Strengthen the repo's QA-lead signal by improving contract-suite governance, CI reporting quality, and pipeline economics without broad refactors or behavior drift.

## Scope

1. Add explicit Postman collection folder preflight to the Newman harness.
2. Generate a leadership-friendly Newman summary from JSON artifacts in CI.
3. Reconcile the declared Node support contract with the validated CI matrix.
4. Add a concise Postman/Newman standards document for contributors.
5. Optimize CI so pull requests run the smoke harness while `main` / `production` pushes run the full deterministic harness.

## Implementation Notes

- Keep the public API behavior unchanged.
- Prefer reusable scripts over inline workflow shell logic.
- Keep the harness deterministic and local-first.
- Preserve existing artifact outputs under `reports/newman/`.
- Avoid touching unrelated worktree changes.

## Deliverables

- Reusable Postman collection utility module
- Newman summary script wired into CI
- Updated `engines.node`
- `docs/postman-standards.md`
- CI workflow split between smoke and full deterministic Newman modes
- Tests for new script/helper behavior

## Validation

- `npm run lint`
- `npm test -- --runInBand`
- `npm run postman:smoke`
- `npm run postman:harness`
- `actionlint .github/workflows/ci.yml`

## Review Checklist

- Folder preflight fails clearly when configured folders are missing.
- CI summary includes request/assertion totals, report runtimes, and top failing requests.
- Docs and package metadata agree on supported Node versions.
- PRs use the faster smoke gate; branch pushes still run the full deterministic harness.

## Finalization

After you've finished implementing and creating tests, re-check to validate the implementation makes sense and that the adequate professional tests are in place, test, commit, push/pr, merge on green, validate.
