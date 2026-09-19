# AXP City

A small, editable isometric town built with **Phaser 4**. One integer tile grid determines terrain, road connections, building placement and vehicle movement. The default experience is the **Town workshop**: grass, water with banks, connected streets, three building types and cars that obey road occupancy.

Requires Node.js 22.13 or newer (Node 24 is used for local verification).

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/city**. For a production build:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:43174/city**. `HOST` and `PORT` override the listener. `/healthz` reports the build revision and core experience; `/readyz` checks that the client exists.

## Build a town

Choose Explore, Road, Cottage, Shop, Workshop or Clear. Click to inspect or build; drag to pan; scroll or pinch to zoom. The footprint preview shows the required road entrance. Overlapping buildings, water placement and disconnected roads are rejected with an explanation. Clear removes a complete building or an eligible road tile; occupied roads and required entrances are protected. Vehicles reroute when the road network changes.

- `1`–`6`: select a tool; `Escape`: Explore.
- WASD / arrow keys: pan; `+` / `−`: zoom; `H`: center town.
- Space: pause/resume; Command/Ctrl-S: save; Command/Ctrl-Z: undo.
- **Save town** stores the complete map and simulation in this browser. **Load** restores it. A saved town reopens on reload. **New town** is undoable and does not overwrite the saved copy.

Saves are local to this browser and origin. Clearing browser storage removes them. This milestone has no accounts, cloud synchronization, economy, terrain heights or additional transport modes. Background tabs pause the simulation; returning does not fast-forward the town.

## One focused engine

| Responsibility | Source |
|---|---|
| Seeded world, integer terrain, occupancy and road graph | `src/core/` |
| Validated commands, fixed ticks, routing and versioned saves | `src/core/` |
| Coherent procedural art with authored footprints and ground anchors | `game/src/core/art.ts` |
| Phaser camera, chunk cache, pooling, picking and editor | `game/src/core/CoreScene.ts` |
| Static/dev server with no integration workers or database | `src/cli/coreServer.ts` |

Artwork is generated locally from source; there are no missing art folders, external asset requests or generated-image dependencies. [Art contract](assets/core/README.md). [Engine decisions, boundaries and evidence](docs/CORE-ENGINE.md).

## Verification

```sh
npm test
npm run typecheck
npm run build
python3 -m pip install -r e2e/requirements.txt
python3 -m playwright install --with-deps chromium firefox webkit
npm run test:e2e
```

Use `CITY_BROWSER=firefox python3 -m pytest e2e/test_core_city.py -v` or the equivalent `CITY_BROWSER=webkit` command for the other engines. The suite exercises the built application with its production CSP, actual mouse/touch controls, save/load, rejected edits, camera travel, graphics recovery and Canvas fallback. Saved screenshots require visual inspection as well as automated checks.

Historical UI tests for the superseded repository-map presentation are explicitly marked `legacy_ui` and deselected by default. They are retained as references; `--legacy-ui` collects them for work on that historical presentation. Backend data/authorization/backup tests still run. A new core test replaces an old feature only when it actually exercises the core behavior; screenshot files alone are not visual approval.

## Existing repository data

The workshop never opens, converts or deletes the old SQLite store, repository addresses, rule files or custom artwork. GitHub/Trending adapters and their tests remain in this repository, outside the current experience. There is no automatic conversion from fractional historical lot coordinates to the new integer grid. A future integration must explicitly map identities and preserve addresses through a versioned migration.

The service launcher defaults to the core. `CITY_INTEGRATIONS=1 scripts/start-city.sh` runs the preserved integration service for migration/operations work; its data remains separate from browser saves and is not displayed by the workshop. [Historical integration configuration](docs/INTEGRATIONS-ARCHIVE.md). No deployment is performed by building or starting the local workshop.
