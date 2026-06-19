#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## CI Summary"
  echo
  echo "- docs-only: ${DOCS_ONLY:-false}"
  echo "- actionlint: ${ACTIONLINT_RESULT:-unknown}"
  echo "- docs: ${DOCS_RESULT:-unknown}"
  echo "- lint: ${LINT_RESULT:-unknown}"
  echo "- openapi: ${OPENAPI_RESULT:-unknown}"
  echo "- test:unit: ${TEST_UNIT_RESULT:-unknown}"
  echo "- test:ci: ${TEST_CI_RESULT:-unknown}"
  echo "- newman: ${NEWMAN_RESULT:-unknown}"
  echo "- test-report: ${TEST_REPORT_RESULT:-unknown}"
  echo "- allure-report: ${ALLURE_REPORT_RESULT:-unknown}"
  echo "- allure-pages: ${ALLURE_PAGES_RESULT:-unknown}"
  echo "- allure-pages-url: ${ALLURE_PAGES_URL:-not-published}"
  echo "- newman mode: ${NEWMAN_MODE:?NEWMAN_MODE is required}"
} >> "${summary_file}"
