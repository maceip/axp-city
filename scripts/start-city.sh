#!/usr/bin/env bash
set -euo pipefail
# Reuse the deployment user's existing GitHub credential without storing it in a release.
if [[ -z "${GITHUB_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  city_github_token=$(gh auth token 2>/dev/null || true)
  if [[ -n "$city_github_token" ]]; then export GITHUB_TOKEN="$city_github_token"; fi
  unset city_github_token
fi
exec node dist/server/cli/server.js "$@"
