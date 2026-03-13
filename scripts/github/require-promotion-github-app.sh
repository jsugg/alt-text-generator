#!/usr/bin/env bash
set -euo pipefail

{
  echo "Exact-SHA promotion to production is blocked."
  echo "Configure vars.REPO_TOOLING_GITHUB_APP_ID and secrets.REPO_TOOLING_GITHUB_APP_PRIVATE_KEY."
  echo "Then add that GitHub App to the protected production branch bypass list before retrying."
} >&2

exit 1
