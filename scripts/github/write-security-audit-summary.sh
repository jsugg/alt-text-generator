#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Security Audit"
  echo
  echo "- Critical: ${AUDIT_CRITICAL:-0}"
  echo "- High: ${AUDIT_HIGH:-0}"
  echo "- Moderate: ${AUDIT_MODERATE:-0}"
  echo "- Low: ${AUDIT_LOW:-0}"
} >> "${summary_file}"
