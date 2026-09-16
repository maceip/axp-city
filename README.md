# AXP City

A shared isometric city rendered by **Phaser 4.2.1**. Every enrolled GitHub repository has a building and a loading zone. Repository metrics and versioned JSON rules determine the building, materials, human crews, robots, drones, and props.

**One repository, one application:** the Node server serves the Phaser client, the city API, SSE streams, exports, and signed GitHub webhooks from one origin. There is no SVG city client or static HTML map to deploy; SVG exists only as an export of the shared plan.

## Run locally

Node 22 or newer is required (`node:sqlite`).

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/city**. This starts the server and Vite together in **explicit fixture mode** (`--offline`): recorded repositories from `out/metrics.json`, a separate `data/offline/` database, and a `RECORDED DATA` label in the status plate. Live GitHub data is never mixed into that store.

To develop against live GitHub instead, start the built server with credentials (see below): `npm run build && GITHUB_TOKEN=… npm start`, or `tsx src/cli/server.ts --dev` with the same variables.

Drag / WASD / arrows to explore, wheel / pinch / `+` `-` to zoom, tap a building to inspect it. `/` focuses repository search (a native text field so phone keyboards and screen readers work); digits jump to lots; `C` opens the searchable census with the MASS bar; `F` follows a named crew member, carrier, or drone on the selected lot; `M` toggles reduced motion; `H` returns home; `Esc` clears selection. The compass, D-pad, zoom, home, overview, and interactive minimap are Phaser HUD objects that also work by touch.

## Build and run the application

```sh
npm run build
npm start
```

The production server listens on **http://127.0.0.1:43174/city**. `/`, `/city`, and `/city.html` serve the same Phaser app. `/healthz` is liveness; `/readyz` is readiness (client bundle present, storage writable, GitHub freshness, delivery backlog). `/api/city/status` reports freshness, the delivery queue, and the **effective** configuration actually in force.

### Configuration

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` | Dedicated GitHub App credentials (recommended). Installation tokens are minted server-side and never leave the process. |
| `GITHUB_TOKEN` | Alternative dedicated fine-grained token. Without either, live refreshes run anonymously under GitHub's low rate limit and `/api/city/status` reports `source: github-anonymous`. |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for `POST /webhooks/github`. Missing configuration denies deliveries; reconciliation polling still runs. |
| `CITY_ADMIN_TOKEN` | Bearer token for `POST /api/city/lots` (enroll) and `DELETE /api/city/lots/<owner>/<name>` (withdraw). Missing configuration denies mutations. Never put this in client code. |
| `CITY_DATA_DIR` | SQLite store directory (`city.sqlite`, verified artwork cache). Default `data` live, `data/offline` fixture. A database created in one mode refuses to open in the other. |
| `CITY_BACKUP_DIR` | When set, a verified `VACUUM INTO` copy of the store is written every 6 hours; the newest 14 are kept. |
| `CITY_RULES_DIR` | City default rules and `approved-artwork.json`, default `.city`. |
| `CITY_ENROLL_FILE` / `--enroll <file>` | Repositories to enroll on start (`owner/name` per line). An empty live city reads `repos.txt`. |
| `CITY_REFRESH_INTERVAL_MS`, `CITY_STALE_AFTER_MS` | Reconciliation cadence (default 15 min) and the age after which data is reported stale (default 45 min). |
| `CITY_RATE_LIMIT_MAX`, `CITY_RATE_LIMIT_WINDOW_MS`, `CITY_TRUSTED_PROXIES` | Webhook flood limits (default 120 / 60 s per client) and the proxy addresses whose `X-Forwarded-For` is trusted (default loopback for Caddy). |
| `CITY_ALERT_URL` | Optional webhook that receives stale-data and recovery alerts from the reconciler. |
| `PORT`, `HOST` | Listener settings. Defaults are loopback and port 43174 in production. |
| `CITY_OFFLINE=1`, `CITY_FIXTURE_PATH` | Explicit fixture mode and its metrics file. The UI labels recorded data; live API failures never switch a client to fixtures. |

The `--rate-limit-max` and `--rate-limit-window-ms` flags take effect and are echoed in the startup log and `/api/city/status`.

## Data and rules

`src/ingest` fetches metrics through GraphQL with REST fallbacks. Fields a fetch could not measure are recorded in `unknownFields`, never as zero; an incomplete refresh carries the last good values forward and the lot is marked `partial`. Crew labels (`human`, `robot`, `mixed`, `unknown`, `none`) come with a written `crewBasis` that names the 14-day window, the sampled authors, and the heuristic used. See [the parser table](docs/PARSER.md).

City defaults live in [`.city/building.json`](.city/building.json) and [`.city/loading-zone.json`](.city/loading-zone.json); `DEFAULT_RULES` in `src/rules/cityFiles.ts` is the single source of truth and a unit test keeps the two identical. A represented repository can override either file in its own default branch with **version 1 or 2** rules: catalog building, star bands, props, bay counts, explicit yard layouts, decor props, and operator-approved custom artwork. See [the rule contract](docs/RULES.md).

Lots are tracked by GitHub repository id, so renames and transfers keep their address. Removal (administrator, repository deleted, or made private) withdraws the lot's public data from snapshots, streams, history, and exports without shifting any neighbour. Persisted plot coordinates are stamped with a layout version; a planner change requires an explicit migration rather than silently moving addresses.

| Code | Responsibility |
| --- | --- |
| `src/ingest`, `src/rules`, `src/parser` | GitHub metrics (App/token/anonymous) and validated rules → `CityLot` |
| `src/world` | Versioned placement and reserved civic geography |
| `src/live` | SQLite city + delivery store, canonical repository resolver, reconciliation |
| `src/webhooks` | Signed deliveries, durable retry worker, HTTP/SSE, admin API, rate limiting |
| `src/game` | Shared lot plans: construction stages, ambient routes, census/MASS, behaviours |
| `game/src` | Phaser scenes: terrain cache, pooled lots, persistent actors, HUD, a11y mirror |
| `src/export`, `src/cli/export.ts` | SVG export from the shared plan; offline package |
| `assets/city-sprites` | Building, ground, prop, and animation artwork (loaded on demand) |

## Exports

- `GET /api/city/export.json` — the canonical snapshot (placements with persisted addresses, geometry, freshness). `npm run render` is only a local preview from `out/metrics.json` with default rules and file order; it is not the canonical city.
- `GET /api/city/export.svg` — SVG of the current plan rendered by `src/export/svg.ts` from the same `planLot` output the game uses.
- In the client, the **capture** HUD button (or `window.__AXP.capture()`) downloads a PNG of the Phaser canvas.
- `npm run export:offline -- --from http://127.0.0.1:43174 --out out/offline` builds a directory with the compiled game, sprites, the saved snapshot, and its SVG; opening `index.html` shows the saved city without a network. The package's `<meta name="city-offline">` tag switches the client into offline-package mode: it loads `city.json`, never opens a stream, and labels the data as saved.

## Verify

```sh
npm test
npm run typecheck
npm run build
python3 -m pip install -r e2e/requirements.txt
python3 -m pytest e2e -v          # hosted Azure Playwright workspace (PLAYWRIGHT_SERVICE_URL + PLAYWRIGHT_SERVICE_ACCESS_TOKEN)
CITY_LOCAL_BROWSER=1 python3 -m pytest e2e -v   # explicit local Chromium fallback
```

The browser suite uses the **production build and the real HTTP/SSE server**. It covers routes and assets, picking, camera and HUD controls, census and MASS, actor persistence across the viewport edge, follow, two browsers receiving rule and metric updates, reconnect and restart, staged construction, rename and removal, reduced motion, mobile touch/pinch, Canvas fallback, the unsupported-browser screen, WebGL context loss, resize, PNG/SVG/offline exports, and 1,000-lot performance. Screenshots and `performance.json` go to `e2e/screenshots/`.

[Deployment](docs/DEPLOY.md) · [City protocol](docs/CITY.md) · [Webhooks](docs/WEBHOOKS.md) · [Authentication](docs/AUTH.md) · [Rules](docs/RULES.md) · [Engine](docs/ENGINE.md) · [Support matrix](docs/SUPPORT.md) · [Performance](docs/PERFORMANCE.md) · [Handoff](docs/PHASER-RECONSTRUCTION-HANDOFF.md)
