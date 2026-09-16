# City sprites (consolidated 2026-09-11)

Copied verbatim from `~/AXP-city-sprites/` so the webapp repo is the single
source of truth. No pixels changed; only the location is new.

## Files (18)

- `buildings-small-01-17-k1.png`, `buildings-medium-18-34-k1.png`,
  `buildings-large-35-50-k1.png` — 50 buildings, S/M/L bands
- `environment-tiles.png` — grass, roads, dual-plot pads, props
- `v2-raw-materials-k1.png` — PR yard materials
- `v2-planning-issues-k1.png` — drafting tables / blueprints
- `v2-lot-states.png`, `v2-lot-states-activity.png` — state examples
- `v3-robot-crew-k1.png` — biped activity crew
- `v3-agent-drones-k1.png`, `v4-facade-drones.png`,
  `v4-ground-construction-bots.png` — agents
- `v3-lot-states-robots.png` — lots with robot crew
- `01-buildings.png`, `02-actors-humans-drones.png`, `03-yards-parcels.png`,
  `04-ground-tiles.png`, `05-lot-examples.png` — earlier pixel pass
  (Kairosoft-style, superseded for look)
- `env-tiles-vector-kit.png` — labeled ground tile legend in building-pack
  style (grass, dirt, concrete, roads, dual-plot bases, park, curbs, water &
  sand, cliffs, snow, props). Reference for the tile pass; not stamped yet.
- `v5-ground-tiles-kit-k1.png` — 34 measured iso ground tiles + props
  (grass/dirt/pave, 6 road pieces, dual-plots, water/sand, park, curb,
  cliffs, snow, trees, lamp, cone, bench, manhole). Lot plates and loading
  aprons use the single grass/dirt/pave diamonds at native aspect — not the
  dual-plot raised hexes. Trees/lamp/bench stamp map decor; see `GROUND_TILES`
  in `src/render/sprites.ts`.
- `v6-anim-unit-walk.png` (34f), `v6-anim-carry-crate.png` (18f),
  `v6-anim-blueprint.png` (26f), `v6-anim-pallet-jack.png` (19f) —
  transparent 384px-grid walk/work cycles (~8 fps) from the grok crew packs.
  Animated via SMIL on recent-activity yards; see `ANIM_SHEETS` and
  `src/render/anim.ts`. Dormant lots stay static.
- `v7-anim-crane-arm.png` (34f), `v7-anim-quad-dog.png` (32f),
  `v7-anim-cargo-drone.png` (16f), `v7-anim-platform-rover.png` (16f) —
  transparent 384px-grid robot cycles (~8 fps) from the grok `axp` pack.
  Bot-detected yards work the robot crew (dog patrol, rover hauler, crane
  arm, cargo airlift) instead of the human crew; high-pressure human yards
  fly the cargo drone; stale pressure yards park a dimmed static quad.

## Keyed transparency (2026-09-13)

Stamped sheets (buildings ×3, v2-raw-materials, v2-planning-issues,
v3-robot-crew, v3-agent-drones, v5-ground-tiles-kit) are flood-keyed to
transparent alpha by `scripts/key_sheets.py` (border flood through
near-white ≥252, plus <25px dust removal) and composite with normal
source-over occlusion — no multiply, no ghosting. Content extents are
unchanged, so the manifests still hold. Re-run the script on any re-cut
sheet. Originals live in git history.

## `unprocessed/` scans (2026-09-12)

Art inbox (local only, git-ignored). 8 of 9 art files are renamed md5 dupes
of `player-repo/` holdings: the two `03_19_00 PM` PNGs = `10_46_14 AM
(1)/(2)` (AXP City themed-building evolutions); the two
`create-an-isometric…` JPGs = `isometric_sprite_sheet.jpg` /
`solarpunk_sprite_sheet.jpg` (craft grids); `image-gen-1/10/3/8` =
`10_38_02 AM (1)/(10)/(3)/(8)` (eco warehouse, watermill, drone hub,
conservatory trios). Only `1ba16fa0-….png` was new (now
`v5-ground-tiles-kit-k1.png` above). The two `grok-workspace.zip`s hold 9
transparent walk/work-cycle packs (unit01: walk, carry-box, carry-ladder,
push-cart; crew: blueprint, carry-crate, carry-ladder, pallet-jack,
wheelbarrow) — 4 atlases ingested as `v6-anim-*`; the other 5 stay zipped
for the next pass. `cDY1Ciay5P0XLpGh-grok-workspace.zip` (`axp` pack: crane
34f, quad 32f, drone 16f, platform 16f) — all 4 ingested as `v7-anim-*`.

## Overlap note

The six hashed files directly under `assets/*.png` were byte-identical
duplicates of six sheets here on consolidation day — that ended with the
`-k1` keying pass (the named copies are now RGBA; the hashed ones are still
the opaque originals). The table below maps them to the pre-key names:

| `assets/*.png` (old, hashed) | Same as here |
| --- | --- |
| `4588de….png` | `buildings-small-01-17-k1.png` |
| `874613….png` | `buildings-medium-18-34-k1.png` |
| `c7a9a6….png` | `buildings-large-35-50-k1.png` |
| `cf5628….png` | `environment-tiles.png` |
| `665c13….png` | `v2-lot-states-activity.png` |
| `d7991f….png` | `v3-lot-states-robots.png` |

Prefer the descriptively named copies in this folder. The old hashed files
are left untouched to avoid rewriting history.

## `player-repo/` (added 2026-09-11, 15 files, copied verbatim from
`~/AXP-city-sprites/new_player_repo_assets/`)

Eco/garden-style building sheets for **player-owned repo lots** (personal
atlas / home workshop), not system-map lots: ten S/M/L building trios
(eco warehouse, workshop, greenhouse ×2 styles, lodge, observatory,
orchard, watermill, maker workshop, pavilion) plus two 5×3 craft-building
grids (`isometric_sprite_sheet.jpg`, `solarpunk_sprite_sheet.jpg`:
loom, greenhouse, honey, bathhouse, kiln, mill, clockwork, mushroom,
lighthouse, paper, clock tower, crystal PR tower, pagoda, etc.).
Original ChatGPT filenames kept; rename descriptively once a lot→building
mapping is locked. Style note: lush eco/garden look — closer to the garden
flavor (§1.6 of the UX doc) than the construction-city system map.
The two `10_46_14 AM` sheets arrived after the first batch; contents not yet
reviewed — verify before using as reference.
`44a28376-….png` (added 11:55): 20-pose human crew sheet — shovel, 2-person
lumber carry, wheelbarrow, ladder/sack/beam carry, cutting, bricklaying,
jackhammer, welding, cement cart, painting, sawing, surveyor, blueprint
reading, drill, forklift, supervisor. Poses cover much of the crew gap
list, BUT the sheet is front-facing 3/4 view, not isometric, single static
poses (no walk cycle) — needs an iso redraw pass before it can drop on the
map. Possible interim use: Hunt board / agent tiles / marketing.

## Tileset revamp (2026-09-16)

Fetched packs from marble.monster (`1.zip`/`2.zip`/`3.zip`) plus the attached
construction/parking/gates/bank sheet were **filtered and restyled**, not
dropped in raw. `scripts/restyle_tileset.py` compresses saturation toward the
existing olive-cream-slate catalog, keys teal/mauve/white backgrounds, and
rejects FarmVille interiors, Viking/Farm Frenzy chrome, SimCity 2000
orthographic sheets, photoreal fruit icons, and Jane's raw orange HUD.

- `buildings-*-k1.png` — ChatGPT 10×3 AXP isometric families + original
  pagoda (id 17), packed on a 5-column grid. Repo lots pick `buildingId`
  1–50 as before; `facadeTint` + `dressingProp` are a second hash so two
  lots that share a silhouette do not look like the same house.
- `civic-kit-k1.png` — restyled center office compound (`CENTER_OF_MAP_HQ`,
  stamped larger than any repo lot), Jane's city hall / church / villa / store
  (odd unused buildings), attached construction stages (pad→posts→roof→shell,
  never the finished bank), parking, gates, bank, isometric plants from the
  v5 ground kit, and full-size restyled road/bike tiles that read at overview
  zoom (not the leftover 4px diamonds).
- `hud-kit-k1.png` — olive-slate + gold panels painted to Jane's chrome sizes
  so the overlay matches the catalog vibe; leftover orange HUD is not used.

Rejected on sight: waterfall photo from Jane's map pack, FarmVille rooms,
photoreal apple tree icons, robot/vehicle sheets that clash at lot scale.

