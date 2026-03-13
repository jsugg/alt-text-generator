#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## CI Summary"
  echo
  echo "- actionlint: ${ACTIONLINT_RESULT:-unknown}"
  echo "- lint: ${LINT_RESULT:-unknown}"
  echo "- test: ${TEST_RESULT:-unknown}"
  echo "- newman: ${NEWMAN_RESULT:-unknown}"
  echo "- test-report: ${TEST_REPORT_RESULT:-unknown}"
  echo "- allure-report: ${ALLURE_REPORT_RESULT:-unknown}"
  echo "- allure-pages: ${ALLURE_PAGES_RESULT:-unknown}"
  echo "- allure-pages-url: ${ALLURE_PAGES_URL:-not-published}"
  echo "- newman mode: ${NEWMAN_MODE:?NEWMAN_MODE is required}"
} >> "${summary_file}"
