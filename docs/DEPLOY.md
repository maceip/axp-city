# Deploy the single Phaser application

The live site is **https://demo.glint.sh/city** on `secure.build`, managed as `devuser`. Caddy proxies the entire site to the Node process on loopback port 43174, including `/city`, `/assets/`, `/api/`, `/webhooks/`, `/healthz`, and `/readyz`. The old static SVG docroot is not the application.

## One-time server configuration

Create `~/axp-city/env` (mode **600**) with dedicated application credentials. `scripts/deploy.sh` refuses to run without it:

```sh
GITHUB_APP_ID=…
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
…"
GITHUB_APP_INSTALLATION_ID=…
GITHUB_WEBHOOK_SECRET=…
CITY_ADMIN_TOKEN=…
# optional: CITY_ALERT_URL=https://… (stale/recovery alerts), CITY_TRUSTED_PROXIES=127.0.0.1,::1
```

A dedicated fine-grained `GITHUB_TOKEN` may stand in for the App variables. The deployment user's personal `gh` login is **not** used (see `AUTH.md`). The systemd drop-in installed by the deploy reads this file through `EnvironmentFile`, sets `CITY_DATA_DIR=~/axp-city/data` and `CITY_BACKUP_DIR=~/axp-city/backups`, and starts `scripts/start-city.sh` from the active release.

## Release

Automated: the **Deploy verified commit** workflow (`.github/workflows/deploy.yml`) runs after **Verify Phaser city** succeeds on `main`, or on manual dispatch with a commit that passed verification. It requires `CITY_DEPLOY_SSH_KEY`, `CITY_DEPLOY_KNOWN_HOSTS`, and `CITY_DEPLOY_TARGET` in the `production` environment and never falls back to a personal credential. It then runs the same script an operator would:

```sh
bash scripts/deploy.sh devuser@secure.build
```

The script, from a clean committed checkout of `maceip/axp-city`:

1. runs `npm test` and `npm run typecheck` (skipped with `CITY_SKIP_CHECKS=1` when CI already verified the exact commit), then `npm run build`;
2. archives tracked source plus `dist/` and uploads it to an immutable `~/axp-city-releases/<commit>/`;
3. takes a **verified backup** of the live store (`scripts/backup-city.mjs`: `VACUUM INTO`, then `integrity_check` and a row count on the copy) into the release directory; a legacy `city-map.json`, if still present, is copied too;
4. installs the systemd drop-in, switches the `~/axp-city-app` symlink atomically, and restarts `axp-webhooks.service`;
5. waits for `/healthz` to report the exact `buildRevision` **and** `/readyz` to return 200 on loopback;
6. runs `scripts/verify-city.mjs` against loopback (revision, Phaser bundle and every referenced asset, snapshot, SVG export, SSE snapshot event, webhook and admin denials) and keeps `verify-local.json` in the release;
7. updates only the `demo.glint.sh` block in Caddy (`scripts/configure-city-proxy.py`, validated and reloaded, unrelated sites untouched, root-readable backup kept);
8. runs the same verification against the public URL and keeps `verify-public.json`.

Any failure after step 4 restores the previous drop-in and symlink, restarts the service, waits for the previous release to answer, and exits non-zero. The shared data directory is never replaced.

## Verify the active release

```sh
node scripts/verify-city.mjs https://demo.glint.sh <commit>
curl --fail https://demo.glint.sh/readyz
```

`renderer` must be `phaser-4`, `buildRevision` must equal the deployed commit, and `/readyz` must show `clientBundle`, `storageWritable`, and `githubFresh` true with no backlog. Then open `/city` in desktop and mobile browsers: inspect a building, pan/zoom, open the census, and exercise a signed webhook through the public URL. The browser must report Phaser 4.2.1 and receive a current snapshot after reconnect. Staleness alerts (`CITY_ALERT_URL`) are exercised by the reconciler when the last successful refresh exceeds `CITY_STALE_AFTER_MS`.

## Roll back application code

```sh
bash scripts/rollback.sh devuser@secure.build            # release recorded in previous-release.txt
bash scripts/rollback.sh devuser@secure.build <commit>   # a specific ~/axp-city-releases/<commit>
```

The script backs up the store, records where it is rolling back from, switches the drop-in and symlink, restarts, waits for health and readiness with the target's revision, and verifies the public path. City data written since the failed deploy is kept; **rolling back code never restores an older database**. Restoring a backup (`~/axp-city/backups/city-<time>.sqlite` or a release's `city.before.sqlite`) is a deliberate, separate step: stop the service, copy the backup to `~/axp-city/data/city.sqlite`, remove any `-wal`/`-shm` files, start, and verify — accepting that events after the backup are lost. Restoring to another host is the same copy plus the env file and `npm run build` artifacts. `e2e/test_operations.py` rehearses exactly this copy-and-start restore against a second server and checks the city, history and delivery memory match.

## Backups and retention

The server writes a verified backup every 6 hours to `CITY_BACKUP_DIR`, keeping the newest 14, and prunes completed deliveries after 14 days and public events after 30 days (newest 500 kept). Copy `~/axp-city/backups/` off-host on your own schedule; the store is a single file and any copy passes the same `integrity_check` that `backup-city.mjs` runs.

Do not use the old `rsync --delete` plus `out/city.html` procedure. Do not replace `data/` with checkout files. The static releases under `/var/www/axp-city-releases` can remain as historical backups; Caddy no longer serves them.
