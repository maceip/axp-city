# AXP City

A real **GitHub → isometric city** pipeline. Each repository becomes two adjacent plots: a **building pad** sized from stars, and a **receiving yard** whose props come from open issues, open PRs, and recent activity.

This is not a collage and not a hardcoded demo. The twelve Android repos in `repos.txt` are just the first city the CLI paints.

## Pipeline

```
repos.txt  →  ingest/  →  out/metrics.json
                 ↓
              parser/  →  CityLot[]     ← city logic lives here
                 ↓
              render/  →  out/city.html
```

| Module | Role |
| --- | --- |
| `src/ingest/` | GitHub GraphQL (token) or REST. Writes `fixtures/github/` so later runs and tests can stay offline. |
| `src/parser/` | Pure `RepoMetrics → CityLot`. Thresholds and precedence are documented in code and in [`docs/PARSER.md`](docs/PARSER.md). |
| `src/render/` | Isometric SVG city (environment tiles + building silhouettes 01–50). Labels `owner/name`. |
| `src/cli/` | `ingest`, `render`, `demo`, `preview`. |

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

# Serve the exported city
npm run preview
```

`npm test` runs the parser unit tests (dormant / issues quiet / issues active / PRs quiet / PRs active, plus precedence, bands, and drones).

Without a token, GitHub’s unauthenticated limit is 60 req/hour. The client falls back to `fixtures/github/batch.json` if a live fetch fails.

## Demo repos

See `repos.txt`. After `npm run demo`, open `out/city.html` (and `out/city.png` if a screenshot was exported). Every lot is labeled with `owner/name`. Lot state is whatever the parser emits for the recorded (or freshly fetched) metrics — never a per-name switch.

## Style references

`assets/city-sprites/` holds the 18 consolidated city sprite sheets (buildings 01–50, environment tiles, yards, crew, drones) plus the earlier 01–05 pixel pass. The full screen/state language is frozen in [`docs/AXP-UX-SCREENS.md`](docs/AXP-UX-SCREENS.md); the Hunt board mock is [`docs/hunter-board-mock.html`](docs/hunter-board-mock.html). The renderer currently draws SVG silhouettes in that language; it does not stamp these PNGs as a sprite sheet yet.
