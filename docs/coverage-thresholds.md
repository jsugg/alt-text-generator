# Coverage thresholds

`npm run test:coverage` and `npm run test:ci` use explicit production coverage scope from
`config/jest/jest.base.cjs`:

- all runtime source: `src/**/*.js`
- runtime config: `config/**/*.js`
- QE-critical release scripts:
  - `scripts/run-postman-deploy.js`
  - `scripts/run-postman-live.js`
  - `scripts/postman-fixture-server.js`
  - `scripts/github/promote-to-production.js`

Coverage ignores `tests/**`, `coverage/**`, and `reports/**` so test helpers and generated reports do
not change production/runtime coverage.

## Ratchet exceptions

Global target remains 80% statements, 80% lines, 80% functions, and 70% branches. The files below
have lower file-level ratchets because they started below that target in QE-005 baseline coverage.

Owner for each exception: QE / Release Engineering. Expiry: 2027-03-31.

Ratchets were re-measured on 2026-11-10 against the full `test:coverage` run and raised to
the measured floor where coverage had grown.

| File | Current ratchet | Exception reason |
| --- | --- | --- |
| `scripts/github/promote-to-production.js` | 54% statements, 56% branches, 62% functions, 54% lines | Promotion auth/GitHub API paths need more seams before global target is practical. |
| `scripts/postman-fixture-server.js` | 60% statements, 41% branches, 59% functions, 60% lines | Fixture route/error branches need focused harness tests. |
| `scripts/run-postman-deploy.js` | 70% statements, 64% branches, 62% functions, 71% lines | Deploy verifier has live-network and failure-output paths not yet fully isolated. |
| `scripts/run-postman-live.js` | 25% statements, 12% branches, 14% functions, 25% lines | Live-provider CLI paths need injectable provider/process seams. |
| `src/server/serverFunctions.js` | 84% statements, 44% branches, 74% functions, 84% lines | Runtime lifecycle branch matrix needs expanded fatal/cleanup coverage. |
| `src/server/startApplicationRuntime.js` | 86% statements, 60% branches, 20% functions, 88% lines | Bootstrap failure and signal branches need isolated process seams. |

`src/services/ReplicateDescriberService.js` has graduated: it now exceeds the global target, and
its file-level ratchet (84% statements, 78% branches, 83% functions, 85% lines) remains as a
critical-file gate rather than an exception.

Raise or remove these exceptions before the expiry, or update this table with a new owner-approved
expiry and remediation reason.
