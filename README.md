# AXP City

A real **GitHub → isometric city** pipeline. Each repository becomes two adjacent plots: a **building pad** sized from stars, and a **loading zone** (receiving yard) whose props come from open issues, open PRs, and recent activity.

The live map is a **Phaser 4** WebGL client (`npm run game`) that stamps the flood-keyed sprite sheets in `assets/city-sprites/`. The SVG exporter (`npm run render`) is still there for static HTML. Neither invents lots — both read `CityLot[]` from the parser.

This is not a collage and not a hardcoded demo. The twelve Android repos in `repos.txt` are just the first city the pipeline paints.

## Pipeline

```
repos.txt  →  ingest/  →  out/metrics.json
                 ↓
              parser/  →  CityLot[]     ← city logic lives here
                 ↓
         ┌───────┴────────┐
         ↓                ↓
      render/          game/
   out/city.html     Phaser 4 map
```

| Module | Role |
| --- | --- |
| `src/ingest/` | GitHub GraphQL (token) or REST. Writes `fixtures/github/` so later runs and tests can stay offline. |
| `src/parser/` | Pure `RepoMetrics → CityLot`. Thresholds and precedence are documented in code and in [`docs/PARSER.md`](docs/PARSER.md). |
| `src/render/` | Shared isometric layout + SVG exporter (dual-plot lots, ground kit, forest ring). |
| `src/game/` | Phaser-agnostic stamp plan. Same projector, sheets, and yard props as SVG. |
| `game/` | Phaser 4.2 WebGL client: texture frames from the measured atlases, animated crew, pan/zoom. |
| `src/cli/` | `ingest`, `render`, `demo`, `preview`. |
| `.city/` | In-repo **building** and **loading-zone** rules. Same thresholds the parser applies. |

## Thresholds (parser)

Documented in `src/parser/thresholds.ts` and [`docs/PARSER.md`](docs/PARSER.md).

- **Building band** from stars: S `< 5k` (IDs 01–17), M `5k–20k` (18–34), L `≥ 20k` (35–50).
- **Recent** = `pushed_at` within **14 days** **or** default-branch commits in that window.
- **Yard precedence**: open PRs beat open issues. If both exist, the yard keeps PR materials *and* a small blueprint.
- **Drones** when `openPrs ≥ 15` or a bot/agent author is present.

## Commands

```bash
npm install

# Live fetch (uses GITHUB_TOKEN when set; degrades to unauthenticated REST)
npm run ingest -- --repos repos.txt

# Parse + write out/city.html from the last ingest
npm run render

# Both, for the 12 demo repos
npm run demo

# Offline, from recorded fixtures
npm run demo -- --offline

# Serve the exported SVG city
npm run preview

# Phaser 4 client (parser lots + real sprite sheets)
npm run game
```

`npm test` runs the parser unit tests (dormant / issues quiet / issues active / PRs quiet / PRs active, plus precedence, bands, drones) and the Phaser stamp-plan tests.

Without a token, GitHub’s unauthenticated limit is 60 req/hour. The client falls back to `fixtures/github/batch.json` if a live fetch fails.

`npm run game` prefers `out/lots.json` when present (so a fresh ingest/render is what you walk), otherwise it parses the recorded fixture snapshot. Building and loading-zone rules live in [`.city/building.json`](.city/building.json) and [`.city/loading-zone.json`](.city/loading-zone.json).

## Demo repos

See `repos.txt`. After `npm run demo`, open `out/city.html` or run `npm run game`. Every lot is labeled with `owner/name`. Lot state is whatever the parser emits for the recorded (or freshly fetched) metrics — never a per-name switch.

## Style references

`assets/city-sprites/` holds the consolidated city sprite sheets (buildings 01–50, environment tiles, yards, crew, drones) plus the earlier 01–05 pixel pass. The full screen/state language is frozen in [`docs/AXP-UX-SCREENS.md`](docs/AXP-UX-SCREENS.md); the Hunt board mock is [`docs/hunter-board-mock.html`](docs/hunter-board-mock.html). The renderer stamps real building, yard, decor, and animated-crew sprites (`src/render/sprites.ts` manifests) over the lot grid; serve the whole `assets/city-sprites/` dir at `/assets/sprites/` for the images to resolve (live: `/assets/sprites/` on demo.glint.sh).
