#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

mkdir -p reports/security

report_file="reports/security/npm-audit.json"
stderr_file="reports/security/npm-audit.stderr.log"
max_attempts="${AUDIT_MAX_ATTEMPTS:-3}"
audit_scope="${AUDIT_SCOPE:-production}"

if [[ ! "${max_attempts}" =~ ^[1-5]$ ]]; then
  echo "AUDIT_MAX_ATTEMPTS must be an integer from 1 through 5" >&2
  exit 2
fi

case "${audit_scope}" in
  production | full)
    ;;
  *)
    echo "AUDIT_SCOPE must be either production or full" >&2
    exit 2
    ;;
esac

report_is_complete() {
  node - "${report_file}" <<'NODE'
const fs = require('node:fs');

try {
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const counts = report?.metadata?.vulnerabilities;
  const required = ['critical', 'high', 'moderate', 'low', 'total'];
  const valid = counts && required.every(
    (key) => Number.isInteger(counts[key]) && counts[key] >= 0,
  );

  process.exit(valid ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

: > "${stderr_file}"
status=2
available=false

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  attempt_stderr="${stderr_file}.attempt-${attempt}"
  set +e
  if [[ "${audit_scope}" == "full" ]]; then
    npm audit --audit-level=high --json > "${report_file}" 2> "${attempt_stderr}"
  else
    npm audit --omit=dev --audit-level=high --json > "${report_file}" 2> "${attempt_stderr}"
  fi
  status=$?
  set -e

  cat "${attempt_stderr}" >> "${stderr_file}"
  rm -f "${attempt_stderr}"

  if report_is_complete; then
    available=true
    break
  fi

  if ((attempt < max_attempts)); then
    delay=$((attempt * 2 + RANDOM % 2))
    echo "npm audit returned no complete report (attempt ${attempt}/${max_attempts}); retrying in ${delay}s" \
      | tee -a "${stderr_file}" >&2
    sleep "${delay}"
  fi
done

printf 'status=%s\n' "${status}" >> "${GITHUB_OUTPUT}"
printf 'available=%s\n' "${available}" >> "${GITHUB_OUTPUT}"

node scripts/github/parse-security-audit-report.js \
  --report-file "${report_file}" \
  --output-file "${GITHUB_OUTPUT}"
