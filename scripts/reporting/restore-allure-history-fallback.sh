#!/usr/bin/env bash
set -euo pipefail

results_dir="${1:?results directory is required}"
report_url="${2:?report URL is required}"

if [ -d "${results_dir}/history" ] && find "${results_dir}/history" -type f ! -name '.gitkeep' -print -quit | grep -q .; then
  exit 0
fi

node scripts/reporting/fetch-allure-history.js \
  --results-dir "${results_dir}" \
  --report-url "${report_url}"
