#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

if [ -n "${REPO_TOOLING_GITHUB_APP_ID:-}" ] && [ -n "${REPO_TOOLING_GITHUB_APP_PRIVATE_KEY:-}" ]; then
  echo "use_github_app=true" >> "${GITHUB_OUTPUT}"
  echo "token_source=github_app" >> "${GITHUB_OUTPUT}"
else
  echo "use_github_app=false" >> "${GITHUB_OUTPUT}"
  echo "token_source=github_token" >> "${GITHUB_OUTPUT}"
fi
