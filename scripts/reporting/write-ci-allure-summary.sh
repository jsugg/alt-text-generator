#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Allure Report"
  echo
  if [ "${HAS_RESULTS:-false}" = "true" ]; then
    echo "- HTML report uploaded as the \`allure-report\` artifact."
    echo "- Raw results merged from the canonical Node 20 Jest lane and the \`${NEWMAN_MODE:?NEWMAN_MODE is required}\` Newman run."
    echo "- Report kind: \`${REPORT_KIND:?REPORT_KIND is required}\`."
    echo "- History stream: \`${HISTORY_KEY:-none}\`."
    echo "- History restored from artifact: \`${HISTORY_RESTORED:-false}\`."
    echo "- History persisted as artifact: \`${PERSIST_HISTORY:?PERSIST_HISTORY is required}\`."
    echo "- GitHub Pages published: \`${PUBLISH_PAGES:?PUBLISH_PAGES is required}\`."
    echo "- GitHub Pages report URL: \`${PAGES_REPORT_URL:-not-published}\`."
  else
    echo "- No Allure raw results were available to merge."
  fi
} >> "${summary_file}"
