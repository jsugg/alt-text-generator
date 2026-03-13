#!/usr/bin/env bash
set -euo pipefail

summary_file="${1:?summary file is required}"

{
  echo "## Promotion Authentication"
  echo
  if [ "${TOKEN_SOURCE:-github_token}" = "github_app" ]; then
    echo "- Token source: GitHub App installation token"
    echo "- Expected behavior: the production ref update should emit downstream push workflow runs."
  else
    echo "- Token source: GitHub App not configured"
    echo "- Exact-SHA promotion is blocked until the repository automation app is configured."
    echo "- To restore automatic production push workflows, configure vars.REPO_TOOLING_GITHUB_APP_ID and secrets.REPO_TOOLING_GITHUB_APP_PRIVATE_KEY."
    echo "- The app must also be allowed to update the protected production branch ref."
  fi
} >> "${summary_file}"
