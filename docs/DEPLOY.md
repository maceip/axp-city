# Deploy to secure.build (demo.glint.sh)

SSH as `devuser` (keys in place; the `mac` user is refused).

```sh
cd /Users/mac/AXP-city-sprites

# 1. Sync code + art + fresh render. data/ (event log) and node_modules
#    are never touched.
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude data \
  --exclude unprocessed --exclude e2e/screenshots \
  --exclude __pycache__ --exclude ai-game-studio --exclude .DS_Store \
  ./ devuser@secure.build:~/axp-city/

# 2. Restart the webhook catcher (systemd user unit, keeps data/).
ssh devuser@secure.build \
  'systemctl --user restart axp-webhooks.service && sleep 3 && \
   systemctl --user is-active axp-webhooks.service && \
   curl -s http://127.0.0.1:43174/healthz'

# 3. Publish the static map. Caddy serves /city and /assets/* from the
#    docroot, NOT from ~/axp-city — both must be copied (sudo needed).
#    PNGs are served immutable (1yr), so any re-cut sheet MUST be renamed
#    (see the -k1 suffixes) or browsers keep the old bytes.
ssh devuser@secure.build 'set -e
  sudo -n cp ~/axp-city/out/city.html /var/www/axp-city/city.html
  sudo -n cp ~/axp-city/assets/city-sprites/*.png /var/www/axp-city/sprites/
  cd /var/www/axp-city/sprites
  for f in *.png; do
    [ -e ~/axp-city/assets/city-sprites/"$f" ] || sudo -n rm -- "$f"
  done'
```

Verify: `curl -s https://demo.glint.sh/city | grep -c k1.png`
(must be >0, `mix-blend` must be 0), plus spot-check a sprite 200:

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  https://demo.glint.sh/assets/sprites/buildings-small-01-17-k1.png
```
