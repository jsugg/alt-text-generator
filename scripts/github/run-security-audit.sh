#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

mkdir -p reports/security

set +e
npm audit --omit=dev --audit-level=high --json \
  > reports/security/npm-audit.json \
  2> reports/security/npm-audit.stderr.log
status=$?
set -e

printf 'status=%s\n' "${status}" >> "${GITHUB_OUTPUT}"

node scripts/github/parse-security-audit-report.js \
  --report-file reports/security/npm-audit.json \
  --output-file "${GITHUB_OUTPUT}"
