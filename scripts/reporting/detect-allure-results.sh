#!/usr/bin/env bash
set -euo pipefail

results_dir="${1:?results directory is required}"
output_file="${2:-${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}}"
output_name="${3:-has-results}"

if find "${results_dir}" -type f ! -name '.gitkeep' -print -quit | grep -q .; then
  printf '%s=true\n' "${output_name}" >> "${output_file}"
else
  printf '%s=false\n' "${output_name}" >> "${output_file}"
fi
