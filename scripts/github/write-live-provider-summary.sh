#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Live Provider Validation"
  echo
  echo "- Event: ${GITHUB_EVENT_NAME:-unknown}"
  echo "- Provider scope: ${LIVE_PROVIDER_SCOPE:-unresolved}"
  echo
} >> "${summary_file}"

if [ -d reports/newman ]; then
  if ! node scripts/github/write-newman-summary.js \
    --reports-dir reports/newman \
    --collection-path postman/collections/alt-text-generator.postman_collection.json \
    --summary-file "${summary_file}"; then
    {
      echo "## Newman Summary"
      echo
      echo "- Summary generation failed unexpectedly."
      echo "- Inspect the Newman CLI logs above and the uploaded Newman artifacts for raw failure details."
    } >> "${summary_file}"
  fi
else
  echo "- No Newman reports were produced." >> "${summary_file}"
fi
