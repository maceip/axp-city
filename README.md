# AXP City

A shared isometric city rendered by **Phaser 4.2.1**. Every GitHub repository has a building and a loading zone. Repository metrics and versioned JSON rules determine the building, materials, human crews, robots, and drones.

**One repository, one application:** the Node server serves the Phaser client, the city API, and signed GitHub webhooks. There is no SVG city client or static HTML map to deploy.

## Run locally

Node 22 or newer is recommended (minimum 20).

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/city**. This starts the server and Vite together, with clearly labeled offline fixtures. `npm run game` is an alias for this same command.

Drag / WASD to explore, wheel / pinch to zoom, tap a building to inspect it. Search or keys 1–0 jump to repositories. F follows activity on the selected lot. The D-pad, overview, zoom buttons, and sky control also work on touch screens.

## Build and run the application

```sh
npm run build
npm start
```

The production server listens on **http://127.0.0.1:43174/city**. `/`, `/city`, and `/city.html` all serve the same Phaser app. Its API and live stream use the same origin.

- `GITHUB_TOKEN`: server-only GitHub token for authenticated metrics/rule reads and reconciliation on startup and every 15 minutes. Without it, signed deliveries still refresh public repos through rate-limited REST; periodic reconciliation is disabled.
- `GITHUB_WEBHOOK_SECRET`: HMAC secret for `POST /webhooks/github`. Missing configuration denies deliveries; it does not stop the public reader.
- `CITY_ADMIN_TOKEN`: bearer token for `POST /api/city/lots`. Missing configuration denies mutations. Never put this in client code.
- `CITY_DATA_DIR`: persistent state directory, default `data`. Preserve it across deployments.
- `CITY_RULES_DIR`: city default-rule directory, default `.city`.
- `PORT`, `HOST`: listener settings. Defaults are loopback and port 43174 in production.
- `CITY_OFFLINE=1`, `CITY_FIXTURE_PATH`: explicit local/testing mode and fixture source. The UI labels recorded data. Live API failures never switch the client to fixtures.

For a built offline preview: `npm run preview`. To import GitHub metrics explicitly: `npm run ingest`; to import the recorded snapshot: `npm run demo -- --offline`. `npm run render` exports **JSON data**, not a second renderer.

## Rules and shared world

City defaults live in [`.city/building.json`](.city/building.json) and [`.city/loading-zone.json`](.city/loading-zone.json). A represented repository can override either file in **its own default branch**. The server fetches and validates those files during repository refreshes, then applies them to the parser. See [the rule contract](docs/RULES.md).

Lots retain their persisted order and addresses around Central Park. Freeway, tram, river, and plaza corridors are reserved before lots are assigned. New lots animate construction for 45 seconds from a server timestamp. Viewport chunks provide infinite surrounding terrain; distant lots do not retain active sprites or animations.

| Code                                    | Responsibility                                                    |
| --------------------------------------- | ----------------------------------------------------------------- |
| `src/ingest`, `src/rules`, `src/parser` | GitHub metrics and repository rules → `CityLot`                   |
| `src/world`                             | Stable placement and reserved civic geography                     |
| `src/live`, `src/webhooks`              | Atomic persistence, authenticated updates, JSON snapshots and SSE |
| `src/game`, `game/src`                  | Visible-lot plans, Phaser rendering, camera, touch, HUD           |
| `src/render`                            | Shared projection and measured sprite atlas metadata only         |
| `assets/city-sprites`                   | Existing building, ground, prop, and animation artwork            |

## Verify

```sh
npm test
npm run typecheck
npm run build
python3 -m pip install -r e2e/requirements.txt
python3 -m playwright install chromium
python3 -m pytest e2e -v
```

The browser suite uses the **production build and actual HTTP/SSE server**. It covers interaction, mobile touch/pinch, two browsers, rules and metrics updates, reconnects, restarts, construction completion, infinite terrain, and 1,000-lot rendering. Screenshots and measurements are written to `e2e/screenshots/` (ignored by Git).

[Deployment](docs/DEPLOY.md) · [City protocol](docs/CITY.md) · [Authentication](docs/AUTH.md) · [Recovery record](docs/RECOVERY.md)
