#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Allure Pages"
  echo
  echo "- Published URL: ${PAGE_URL:?PAGE_URL is required}"
  echo "- Published path: ${PAGE_PATH:?PAGE_PATH is required}"
  echo "- Report kind: ${REPORT_KIND:?REPORT_KIND is required}"
  echo "- Site artifact prepared: ${PAGE_ARTIFACT_PREPARED:?PAGE_ARTIFACT_PREPARED is required}"
  echo "- Published via workflow deployment: ${PAGE_DEPLOYED:?PAGE_DEPLOYED is required}"
  echo "- Deployment transport: ${PAGE_TRANSPORT:?PAGE_TRANSPORT is required}"
  if [ -n "${PAGE_BUILD_VERSION:-}" ]; then
    echo "- Pages build version: ${PAGE_BUILD_VERSION}"
  fi
  if [ -n "${SOURCE_EVENT:-}" ]; then
    echo "- Source event: ${SOURCE_EVENT}"
  fi
  if [ -n "${SOURCE_RUN_ID:-}" ]; then
    echo "- Source run ID: ${SOURCE_RUN_ID}"
  fi
  if [ -n "${SOURCE_RUN_CONCLUSION:-}" ]; then
    echo "- Source run conclusion: ${SOURCE_RUN_CONCLUSION}"
  fi
} >> "${summary_file}"
