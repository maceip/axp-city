#!/usr/bin/env bash
# Deploy a tested commit of maceip/axp-city as an immutable release.
#
#   bash scripts/deploy.sh devuser@secure.build
#   bash scripts/deploy.sh local                 # run on secure.build itself
#
# Steps, all of which must succeed or the previous release is restored:
#   1. build client + server from a clean committed checkout and archive them;
#   2. upload to ~/axp-city-releases/<commit>/ and back up the SQLite city store;
#   3. install the systemd drop-in (dedicated credentials come from ~/axp-city/env,
#      never from the release), switch ~/axp-city-app and restart the service;
#   4. wait for /readyz and the exact build revision on loopback;
#   5. point Caddy at the application (only the demo.glint.sh block);
#   6. verify the public path with scripts/verify-city.mjs (revision, bundle,
#      assets, snapshot, SVG, SSE, auth denials) and keep the report in the release.
# Any failure after the switch rolls the code back and re-verifies; the shared
# data directory is never replaced.
set -euo pipefail
cd "$(dirname "$0")/.."
city_target=${1:-devuser@secure.build}
city_public=${CITY_PUBLIC_URL:-https://demo.glint.sh}
city_local=false
if [[ "$city_target" == "local" ]]; then city_local=true; fi
city_remote=$(git remote get-url origin)
if [[ "$city_remote" != *maceip/axp-city* ]]; then
  echo "Expected maceip/axp-city origin" >&2; exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit tracked changes before deploying a reproducible release" >&2; exit 1
fi
city_revision=$(git rev-parse HEAD)
if [[ "${CITY_SKIP_CHECKS:-}" != "1" ]]; then
  npm test
  npm run typecheck
fi
npm run build
city_tmp=$(mktemp -d)
trap 'rm -rf "$city_tmp"' EXIT
mkdir "$city_tmp/release"
git archive HEAD | tar -xf - -C "$city_tmp/release"
cp -R dist "$city_tmp/release/dist"
tar -czf "$city_tmp/$city_revision.tar.gz" -C "$city_tmp/release" .
if [[ "$city_local" == true ]]; then
  mkdir -p "$HOME/axp-city-releases" "$HOME/axp-city/data" "$HOME/axp-city/backups"
  chmod 700 "$HOME/axp-city" "$HOME/axp-city/backups"
  cp "$city_tmp/$city_revision.tar.gz" "$HOME/axp-city-releases/$city_revision.tar.gz"
else
  ssh "$city_target" 'mkdir -p ~/axp-city-releases ~/axp-city/data ~/axp-city/backups && chmod 700 ~/axp-city ~/axp-city/backups'
  scp -q "$city_tmp/$city_revision.tar.gz" "$city_target:axp-city-releases/$city_revision.tar.gz"
fi
if [[ "$city_local" == true ]]; then
  bash -s -- "$city_revision" "$city_public"
else
  ssh "$city_target" bash -s -- "$city_revision" "$city_public"
fi <<'REMOTE'
set -euo pipefail
city_revision=$1
city_public=$2
city_release="$HOME/axp-city-releases/$city_revision"
city_active="$HOME/axp-city-app"
city_dropin="$HOME/.config/systemd/user/axp-webhooks.service.d/50-phaser.conf"
city_env="$HOME/axp-city/env"
if [[ -e "$city_release" ]]; then echo "Release already exists: $city_release" >&2; exit 1; fi
mkdir "$city_release"
tar -xzf "$HOME/axp-city-releases/$city_revision.tar.gz" -C "$city_release"
city_previous=$(readlink "$city_active" || true)
printf '%s\n' "$city_previous" > "$city_release/previous-release.txt"
mkdir -p "$(dirname "$city_dropin")"
if [[ -f "$city_dropin" ]]; then cp "$city_dropin" "$city_release/previous-service.conf"; fi

# Dedicated application credentials live outside every release, readable only
# by the service user. The deploy never prints or copies them.
if [[ ! -f "$city_env" ]]; then
  echo "Missing $city_env. Create it (mode 600) with GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID, GITHUB_WEBHOOK_SECRET and CITY_ADMIN_TOKEN; see docs/DEPLOY.md" >&2
  exit 1
fi
[[ "$(stat -c %a "$city_env")" == "600" ]] || { echo "$city_env must be mode 600" >&2; exit 1; }
for city_key in GITHUB_WEBHOOK_SECRET CITY_ADMIN_TOKEN; do
  grep -q "^$city_key=" "$city_env" || { echo "$city_env lacks $city_key" >&2; exit 1; }
done
if ! grep -q "^GITHUB_APP_ID=" "$city_env" && ! grep -q "^GITHUB_TOKEN=" "$city_env"; then
  echo "$city_env needs GitHub App credentials (GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY/GITHUB_APP_INSTALLATION_ID) or a dedicated GITHUB_TOKEN" >&2; exit 1
fi

# Runtime data is shared and never replaced by the release; keep a verified
# copy of the store as it was before this deploy.
if [[ -f "$HOME/axp-city/data/city.sqlite" ]]; then
  node "$city_release/scripts/backup-city.mjs" "$HOME/axp-city/data" "$city_release/city.before.sqlite" >/dev/null
  chmod 600 "$city_release/city.before.sqlite"
fi
if [[ -f "$HOME/axp-city/data/city-map.json" ]]; then
  cp "$HOME/axp-city/data/city-map.json" "$city_release/city-map.before.json"
  chmod 600 "$city_release/city-map.before.json"
fi

cat > "$city_dropin" <<EOF
[Service]
WorkingDirectory=$city_active
ExecStart=
ExecStart=/usr/bin/bash $city_active/scripts/start-city.sh
EnvironmentFile=-%h/axp-city/env
Environment=CITY_DATA_DIR=%h/axp-city/data
Environment=CITY_BACKUP_DIR=%h/axp-city/backups
Environment=HOST=127.0.0.1
Environment=PORT=43174
# Resource limits: one Node process and a SQLite file. The load case grows the heap by
# under 64 MB, so 1 GiB is a ceiling that turns a leak into a restart, not a target.
MemoryHigh=512M
MemoryMax=1G
TasksMax=128
LimitNOFILE=8192
Restart=on-failure
RestartSec=2
# The process log goes to journald; a burst (a reconcile pass logging every failure)
# is capped rather than allowed to flood the journal.
LogRateLimitIntervalSec=30
LogRateLimitBurst=2000
EOF

rollback() {
  echo "$1; restoring previous release" >&2
  if [[ -f "$city_release/previous-service.conf" ]]; then cp "$city_release/previous-service.conf" "$city_dropin"; else rm -f "$city_dropin"; fi
  if [[ -n "$city_previous" ]]; then ln -sfn "$city_previous" "$city_active.next"; mv -Tf "$city_active.next" "$city_active"; fi
  systemctl --user daemon-reload
  systemctl --user restart axp-webhooks.service
  for city_attempt in $(seq 1 30); do
    if curl --fail --silent http://127.0.0.1:43174/healthz >/dev/null 2>&1; then echo "Previous release is answering again" >&2; break; fi
    sleep 1
  done
  exit 1
}

ln -sfn "$city_release" "$city_active.next"
mv -Tf "$city_active.next" "$city_active"
systemctl --user daemon-reload
systemctl --user restart axp-webhooks.service
city_healthy=false
for city_attempt in $(seq 1 45); do
  if curl --fail --silent http://127.0.0.1:43174/healthz | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("renderer")=="phaser-4" and d.get("buildRevision")==sys.argv[1] else 1)' "$city_revision" 2>/dev/null \
     && curl --fail --silent http://127.0.0.1:43174/readyz >/dev/null 2>&1; then city_healthy=true; break; fi
  sleep 1
done
[[ "$city_healthy" == true ]] || rollback "Health/readiness check failed for $city_revision"
node "$city_release/scripts/verify-city.mjs" http://127.0.0.1:43174 "$city_revision" --report "$city_release/verify-local.json" >/dev/null \
  || rollback "Local verification failed (see $city_release/verify-local.json)"
sudo -n python3 "$city_release/scripts/configure-city-proxy.py" || rollback "Caddy configuration failed"
node "$city_release/scripts/verify-city.mjs" "$city_public" "$city_revision" --report "$city_release/verify-public.json" >/dev/null \
  || rollback "Public verification failed (see $city_release/verify-public.json)"
echo "Deployed $city_revision; $city_public verified (reports in $city_release/verify-*.json)"
REMOTE
