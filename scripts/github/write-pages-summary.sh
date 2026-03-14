#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Allure Pages"
  echo
  echo "- Published URL: ${PAGE_URL:?PAGE_URL is required}"
  echo "- Published path: ${PAGE_PATH:?PAGE_PATH is required}"
  echo "- Published branch: ${PAGE_BRANCH:?PAGE_BRANCH is required}"
  echo "- Branch updated: ${PAGE_CHANGED:?PAGE_CHANGED is required}"
  echo "- Branch commit: ${PAGE_COMMIT_SHA:-not-created}"
  echo "- Report kind: ${REPORT_KIND:?REPORT_KIND is required}"
  echo "- Published via workflow deployment: false"
  echo "- Deployment transport: direct gh-pages branch update"
} >> "${summary_file}"
