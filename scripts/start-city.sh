#!/usr/bin/env bash
# Service entry point. Credentials come from the systemd EnvironmentFile
# (~/axp-city/env): a GitHub App (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY,
# GITHUB_APP_INSTALLATION_ID) or a dedicated fine-grained GITHUB_TOKEN. The
# deployment user's personal `gh` login is no longer borrowed by default; set
# CITY_ALLOW_GH_CLI_TOKEN=1 to opt into that fallback on a development host.
set -euo pipefail
if [[ -z "${GITHUB_APP_ID:-}" && -z "${GITHUB_TOKEN:-}" && "${CITY_OFFLINE:-}" != "1" ]]; then
  if [[ "${CITY_ALLOW_GH_CLI_TOKEN:-}" == "1" ]] && command -v gh >/dev/null 2>&1; then
    city_github_token=$(gh auth token 2>/dev/null || true)
    if [[ -n "$city_github_token" ]]; then
      export GITHUB_TOKEN="$city_github_token"
      echo "[warn] using the gh CLI login as GITHUB_TOKEN (CITY_ALLOW_GH_CLI_TOKEN=1); configure a GitHub App for production" >&2
    fi
    unset city_github_token
  else
    echo "[warn] no GitHub App or GITHUB_TOKEN configured; live refreshes run anonymously with GitHub's low rate limit" >&2
  fi
fi
exec node dist/server/cli/server.js "$@"
