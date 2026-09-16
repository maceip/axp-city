# Building and loading-zone rules

Both rules files are declarative JSON, never executable code. `DEFAULT_RULES` in `src/rules/cityFiles.ts` is the **single source of truth** for default bands, catalog ranges, and props; the files in this checkout's `.city/` directory must stay identical to it (a unit test enforces this), and the old threshold helpers and `uniquifyBuildingIds()` are gone. A represented GitHub repository can declare partial overrides at `.city/building.json` and `.city/loading-zone.json` in its default branch. Refresh order is metrics + validated defaults + repository overrides → parser → persisted lot → Phaser, SVG export, census.

Rules are **versioned**: `version` is 1 (default) or 2. Unknown versions, unknown properties, and invalid values are rejected as a whole file. Version 2 adds custom artwork, yard layouts, and decor props.

## Building (`.city/building.json`)

```json
{ "version": 2, "buildingId": 42, "quietAlpha": 0.5,
  "artwork": { "path": ".city/building.png", "sha256": "…64 hex…", "width": 128, "height": 192 } }
```

- `buildingId` is an integer 1–50 selecting catalog artwork independently of the S/M/L footprint derived from stars. Without it, the repository name hashes stably into its band's `ids` range; buildings can repeat. Default star bands are S below 5,000, M below 20,000, L at 20,000 or more. `bands.S.maxStarsExclusive`, `bands.M.maxStarsExclusive`, and each band's inclusive `ids` pair may be overridden; thresholds must increase and IDs stay in 1–50. `quietAlpha` is in (0,1].
- `artwork` (version 2) is a **request** for custom building artwork: a relative `.png` path inside the repository, its SHA-256, and 32–512 px dimensions. The server fetches the file from the repository's default branch through the Contents API, checks size (≤ 512 KiB), PNG signature, IHDR dimensions, and hash, and then requires an **operator approval** — an entry `{ "repo": "owner/name", "sha256": "…" }` in the city's `.city/approved-artwork.json`. Approved bytes are cached under `<CITY_DATA_DIR>/artwork/<sha>.png` and served same-origin at `/assets/artwork/<sha>.png`; the client loads them on demand. Unapproved, missing, mismatched, or oversized artwork keeps the catalog building and publishes the reason in the inspect card (`rulesWarning`). Artwork is never fetched from arbitrary URLs.

## Loading zone (`.city/loading-zone.json`)

```json
{
  "version": 2,
  "props": {
    "issues": ["blueprint", "drafting-table", "lamp"],
    "prs": ["materials", "cones"],
    "recent": ["crew"],
    "highPrsOrBot": ["drone"]
  },
  "combinedBlueprint": true,
  "layout": { "bays": 3, "slots": [ { "prop": "bench", "x": 0.4, "y": 1.9 }, { "prop": "tree", "x": 1.5, "y": 0.3 } ] }
}
```

- `props` lists, per metric state, which yard props appear. Metric props are `blueprint`, `drafting-table`, `materials`, `crew`, `drone`. Version 2 adds decor props `cones`, `lamp`, `bench`, `tree`, `bush`, `planter`. Empty arrays disable a class of props. PRs take precedence over issues; recent activity activates crews; `combinedBlueprint` controls whether a PR yard also shows an issue blueprint. The fixed precedence is `openPrs`, `openIssues`, `recentActivity`.
- `layout` (version 2): `bays` 1–3 sets how many material stacks a PR yard shows; `slots` (≤ 8) place props explicitly in yard-local coordinates, validated against the yard bounds (0–1.8 × 0–2.2 world units) and a minimum spacing of 0.35. Invalid placements reject the file.

## Behaviour under errors

Missing files (404) use city defaults. Malformed or invalid files use **validated defaults for that file**, keep the lot, and publish `rulesWarning` naming the file; the inspect card and census show it. Upstream authentication, rate-limit, or transport failures fail the refresh, retain the last committed lot, and leave the delivery to the retry schedule. Files are limited to 64 KiB (bytes, checked before parsing). Only the trusted GitHub Contents API is queried; rule files cannot name network endpoints or code to execute.

## Lifecycle

Push webhooks and reconciliation reread the files, so changing a repository's rules changes its lot without deploying the client. Lots are identified by GitHub repository id: **renames and transfers** keep the address and record history; **removal** by an administrator (`DELETE /api/city/lots/owner/name`), deletion on GitHub, or a switch to private withdraws the lot from every public path while keeping its address reserved so no neighbour moves. Construction timestamps and addresses survive rule and metric changes.

## Fixture mode

In fixture mode the same validation path reads per-repository rule files from `<CITY_RULES_DIR>/repos/<owner>/<name>/building.json` and `loading-zone.json`, so the browser suite demonstrates catalog selection, bays, decor props, malformed fallback, and rule changes without GitHub.
