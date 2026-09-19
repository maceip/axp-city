#!/usr/bin/env bash
# Roll the live application back to a previous release without touching city data.
#
#   bash scripts/rollback.sh axp-deploy@secure.build            # previous release recorded by deploy.sh
#   bash scripts/rollback.sh axp-deploy@secure.build <commit>   # a specific release commit
#
# The shared data directory (~/axp-city/data) is never replaced: rolling back the
# code keeps every lot, delivery and history row written since the failed deploy.
# The public path is verified after the switch with scripts/verify-city.mjs.
set -euo pipefail
city_target=${1:?ssh target, e.g. devuser@secure.build}
city_wanted=${2:-}
city_public=${CITY_PUBLIC_URL:-https://demo.glint.sh}
if [[ "$city_target" == axp-deploy@* ]]; then
  if [[ -n "$city_wanted" ]]; then
    [[ "$city_wanted" =~ ^[0-9a-f]{40}$ ]] || { echo "Restricted rollback requires a 40-character commit" >&2; exit 1; }
    exec ssh "$city_target" "rollback $city_wanted"
  fi
  exec ssh "$city_target" rollback
fi
ssh "$city_target" bash -s -- "$city_wanted" "$city_public" <<'REMOTE'
set -euo pipefail
city_wanted=$1
city_public=$2
city_active="$HOME/axp-city-app"
city_dropin="$HOME/.config/systemd/user/axp-webhooks.service.d/50-phaser.conf"
city_current=$(readlink "$city_active" || true)
if [[ -z "$city_wanted" ]]; then
  city_wanted=$(cat "$city_current/previous-release.txt" 2>/dev/null || true)
  [[ -n "$city_wanted" ]] || { echo "No previous release recorded in $city_current/previous-release.txt" >&2; exit 1; }
fi
[[ "$city_wanted" == /* ]] || city_wanted="$HOME/axp-city-releases/$city_wanted"
[[ -f "$city_wanted/dist/server/cli/server.js" ]] || { echo "Not a complete release: $city_wanted" >&2; exit 1; }
city_revision=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["commit"])' "$city_wanted/dist/build-info.json")
echo "Rolling back $city_current -> $city_wanted ($city_revision); data directory stays in place"
# Record the state we are leaving so a further rollback can return to it.
printf '%s\n' "$city_current" > "$city_wanted/rolled-back-from.txt"
node "$city_wanted/scripts/backup-city.mjs" "$HOME/axp-city/data" "$city_wanted/city.before-rollback.sqlite" >/dev/null
chmod 600 "$city_wanted/city.before-rollback.sqlite"
mkdir -p "$(dirname "$city_dropin")"
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
ln -sfn "$city_wanted" "$city_active.next"
mv -Tf "$city_active.next" "$city_active"
systemctl --user daemon-reload
systemctl --user restart axp-webhooks.service
for city_attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:43174/readyz >/dev/null 2>&1; then break; fi
  sleep 1
done
node "$city_wanted/scripts/verify-city.mjs" http://127.0.0.1:43174 "$city_revision" --report "$city_wanted/verify-rollback-local.json" >/dev/null
node "$city_wanted/scripts/verify-city.mjs" "$city_public" "$city_revision" --report "$city_wanted/verify-rollback-public.json" >/dev/null
echo "Rollback verified: $city_public serves $city_revision"
REMOTE
