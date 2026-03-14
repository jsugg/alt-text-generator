#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Allure Pages"
  echo
  echo "- Published URL: ${PAGE_URL:?PAGE_URL is required}"
  echo "- Published path: ${PAGE_PATH:?PAGE_PATH is required}"
  echo "- Report kind: ${REPORT_KIND:?REPORT_KIND is required}"
  echo "- Published via workflow deployment: true"
  echo "- Deployment transport: GitHub Pages REST API"
} >> "${summary_file}"
