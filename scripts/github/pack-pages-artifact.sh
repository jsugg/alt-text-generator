#!/usr/bin/env bash
set -euo pipefail

report_dir="${1:?report directory is required}"
output_tar="${2:?output tar path is required}"

if ! find "${report_dir}" -type f ! -name '.gitkeep' -print -quit | grep -q .; then
  echo "Allure report artifact is empty; cannot publish GitHub Pages content." >&2
  exit 1
fi

tar \
  --dereference --hard-dereference \
  --directory "${report_dir}" \
  -cvf "${output_tar}" \
  --exclude=.git \
  --exclude=.github \
  --exclude=".[^/]*" \
  .
