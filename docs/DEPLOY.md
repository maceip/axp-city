# Deploy the single Phaser application

The live site is **https://demo.glint.sh/city** on `secure.build`, managed as `devuser`. Caddy must proxy the entire site to the Node process on loopback port 43174, including `/city`, `/assets/`, `/api/`, and `/webhooks/`. The old static SVG docroot is no longer the application.

## Release

From a clean, committed checkout of `maceip/axp-city`, after checks and browser verification:

```sh
bash scripts/deploy.sh devuser@secure.build
```

The script builds client and server together, archives tracked source plus `dist/`, uploads a new immutable `~/axp-city-releases/<commit>/` directory, and activates it through `~/axp-city-app`. The service gets a drop-in that points to that application and keeps persistent state at **`~/axp-city/data/`**. The existing webhook secret remains in the existing service configuration; it is never copied into the release or printed. The startup wrapper reuses the deployment user's authenticated GitHub CLI credential when `GITHUB_TOKEN` is not already configured.

The script checks the exact commit through `/healthz` before switching the proxy. It backs up any previous service drop-in and city-map state. The Caddy helper changes only the existing `demo.glint.sh` block, validates the full configuration, and reloads it. It preserves unrelated sites and keeps a root-readable backup. Server health failure restores the previous service configuration.

Do not use the old `rsync --delete` plus `out/city.html` procedure. Do not replace `data/` with checkout files. The static releases under `/var/www/axp-city-releases` can remain as historical backups; Caddy no longer serves them.

## Verify the active release

```sh
curl --fail https://demo.glint.sh/healthz
curl --fail https://demo.glint.sh/api/city
```

`renderer` must be `phaser-4` and `buildRevision` must equal the merged Git commit. Then open `/city` in desktop and mobile browser contexts, inspect a building, pan/zoom, verify assets, and exercise a signed webhook through the public URL. The browser must report Phaser 4.2.1/WebGL and receive a current snapshot after reconnect.

## Roll back application code

Read `~/axp-city-app/previous-release.txt` for the previous application release. Point `~/axp-city-app` back to that directory and restart `axp-webhooks.service`; retain the current shared data. For the first Phaser deployment, `previous-service.conf` exists only if a previous drop-in existed; otherwise removing the newly installed `50-phaser.conf` restores the original service. Restore the matching Caddy backup only if returning to the old static deployment, and check for unrelated configuration changes first.

Rollbacks must be deliberate: inspect current service, symlink, data, and proxy state before changing them. A data backup is for recovery, not an automatic replacement for newer live events.
