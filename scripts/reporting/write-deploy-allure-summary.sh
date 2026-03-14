#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Deploy Allure Report"
  echo
  if [ "${HAS_RESULTS:-false}" = "true" ]; then
    echo "- HTML report uploaded as the \`post-deploy-verification-allure-report\` artifact."
    echo "- Report kind: \`${REPORT_KIND:?REPORT_KIND is required}\`."
    echo "- History stream: \`${HISTORY_KEY:-none}\`."
    echo "- History persisted as artifact: \`${PERSIST_HISTORY:?PERSIST_HISTORY is required}\`."
    echo "- GitHub Pages published: \`false\`."
  else
    echo "- No Allure raw results were available to merge."
  fi
} >> "${summary_file}"
