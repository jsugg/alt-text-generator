#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

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
