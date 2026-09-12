# City sprites (consolidated 2026-09-11)

Copied verbatim from `~/AXP-city-sprites/` so the webapp repo is the single
source of truth. No pixels changed; only the location is new.

## Files (18)

- `buildings-small-01-17.png`, `buildings-medium-18-34.png`,
  `buildings-large-35-50.png` — 50 buildings, S/M/L bands
- `environment-tiles.png` — grass, roads, dual-plot pads, props
- `v2-raw-materials.png` — PR yard materials
- `v2-planning-issues.png` — drafting tables / blueprints
- `v2-lot-states.png`, `v2-lot-states-activity.png` — state examples
- `v3-robot-crew.png` — biped activity crew
- `v3-agent-drones.png`, `v4-facade-drones.png`,
  `v4-ground-construction-bots.png` — agents
- `v3-lot-states-robots.png` — lots with robot crew
- `01-buildings.png`, `02-actors-humans-drones.png`, `03-yards-parcels.png`,
  `04-ground-tiles.png`, `05-lot-examples.png` — earlier pixel pass
  (Kairosoft-style, superseded for look)

## Overlap note

The six hashed files directly under `assets/*.png` are byte-identical
duplicates of six sheets here (verified by md5 on consolidation day):

| `assets/*.png` (old, hashed) | Same as here |
| --- | --- |
| `4588de….png` | `buildings-small-01-17.png` |
| `874613….png` | `buildings-medium-18-34.png` |
| `c7a9a6….png` | `buildings-large-35-50.png` |
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
