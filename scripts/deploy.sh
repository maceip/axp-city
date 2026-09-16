#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
city_target=${1:-devuser@secure.build}
city_remote=$(git remote get-url origin)
if [[ "$city_remote" != *maceip/axp-city* ]]; then
  echo "Expected maceip/axp-city origin" >&2; exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit tracked changes before deploying a reproducible release" >&2; exit 1
fi
city_revision=$(git rev-parse HEAD)
npm run build
city_tmp=$(mktemp -d)
trap 'rm -rf "$city_tmp"' EXIT
mkdir "$city_tmp/release"
git archive HEAD | tar -xf - -C "$city_tmp/release"
cp -R dist "$city_tmp/release/dist"
tar -czf "$city_tmp/$city_revision.tar.gz" -C "$city_tmp/release" .
ssh "$city_target" 'mkdir -p ~/axp-city-releases'
scp -q "$city_tmp/$city_revision.tar.gz" "$city_target:axp-city-releases/$city_revision.tar.gz"
ssh "$city_target" bash -s -- "$city_revision" <<'REMOTE'
set -euo pipefail
city_revision=$1
city_release="$HOME/axp-city-releases/$city_revision"
city_active="$HOME/axp-city-app"
city_dropin="$HOME/.config/systemd/user/axp-webhooks.service.d/50-phaser.conf"
if [[ -e "$city_release" ]]; then echo "Release already exists: $city_release" >&2; exit 1; fi
mkdir "$city_release"
tar -xzf "$HOME/axp-city-releases/$city_revision.tar.gz" -C "$city_release"
city_previous=$(readlink "$city_active" || true)
printf '%s\n' "$city_previous" > "$city_release/previous-release.txt"
mkdir -p "$HOME/axp-city/data" "$(dirname "$city_dropin")"
if [[ -f "$city_dropin" ]]; then cp "$city_dropin" "$city_release/previous-service.conf"; fi
# Runtime data, including the webhook log, is shared and never replaced by the release.
if [[ -f "$HOME/axp-city/data/city-map.json" ]]; then
  cp "$HOME/axp-city/data/city-map.json" "$city_release/city-map.before.json"
  chmod 600 "$city_release/city-map.before.json"
fi
cat > "$city_dropin" <<EOF
[Service]
WorkingDirectory=$city_active
ExecStart=
ExecStart=/usr/bin/bash $city_active/scripts/start-city.sh
Environment=CITY_DATA_DIR=$HOME/axp-city/data
Environment=HOST=127.0.0.1
Environment=PORT=43174
EOF
ln -sfn "$city_release" "$city_active.next"
mv -Tf "$city_active.next" "$city_active"
systemctl --user daemon-reload
systemctl --user restart axp-webhooks.service
city_healthy=false
for city_attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:43174/healthz | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("renderer")=="phaser-4" and d.get("buildRevision")==sys.argv[1] else 1)' "$city_revision" 2>/dev/null; then city_healthy=true; break; fi
  sleep 1
done
if [[ "$city_healthy" != true ]]; then
  if [[ -f "$city_release/previous-service.conf" ]]; then cp "$city_release/previous-service.conf" "$city_dropin"; else rm "$city_dropin"; fi
  if [[ -n "$city_previous" ]]; then ln -sfn "$city_previous" "$city_active.next"; mv -Tf "$city_active.next" "$city_active"; fi
  systemctl --user daemon-reload
  systemctl --user restart axp-webhooks.service
  echo "Health check failed; restored previous service configuration" >&2; exit 1
fi
sudo -n python3 "$city_release/scripts/configure-city-proxy.py"
curl --fail --silent https://demo.glint.sh/healthz
REMOTE
