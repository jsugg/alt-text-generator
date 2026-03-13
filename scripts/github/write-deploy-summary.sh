#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Deploy Verification"
  echo
  echo "- Event: ${GITHUB_EVENT_NAME:-unknown}"
  echo "- Base URL: ${BASE_URL:-unknown}"
  echo "- Production API auth expected: ${PRODUCTION_API_AUTH_ENABLED:-false}"
  echo "- Production deploy validation token configured: ${PRODUCTION_DEPLOY_VALIDATION_API_TOKEN_CONFIGURED:-false}"
  if [ "${PRODUCTION_API_AUTH_ENABLED:-false}" = "true" ] && [ "${PRODUCTION_DEPLOY_VALIDATION_API_TOKEN_CONFIGURED:-false}" != "true" ]; then
    echo "- Protected deploy verification skipped because PRODUCTION_API_AUTH_ENABLED=true but PRODUCTION_DEPLOY_VALIDATION_API_TOKEN is not configured. Render API_AUTH_ENABLED must be true and API_AUTH_TOKENS must include the same token."
  fi
  echo
} >> "${summary_file}"

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
