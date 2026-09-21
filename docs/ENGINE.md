> Historical repository-city documentation. The active core workshop is specified in [CORE-ENGINE.md](CORE-ENGINE.md); claims and measurements below apply to the previous experience.

# Phaser 4 engine

AXP City uses **Phaser 4.2.1** for its live city. This decision is implemented, not a proposal for a future renderer.

The application stays in `maceip/axp-city`. Node handles GitHub access, rules, persistence, and HTTP. Phaser runs in the browser and renders the shared world. Vite is a development/build tool; production serves its output through the same Node process as the API. `game/src/support.ts` feature-detects the browser before Phaser is even downloaded and chooses WebGL, Phaser's Canvas renderer, or an explicit unsupported screen (see `SUPPORT.md`).

## Shared plan, client drawing

`CityLot` is the domain contract. `planCity` turns persisted addresses into placements and reserves civic corridors; the client never assigns addresses. `src/game/plan.ts` (`planLot`) turns a placement into a render plan — ground diamonds, building and yard image stamps, prop positions, human/robot/drone/vehicle **behaviours** (`walk`, `work`, `carry`, `wave`, `fly`, `drive`), and the construction stage — and is shared by the Phaser client, the SVG exporter, and the unit tests, so every consumer draws the same thing. `src/game/ambient.ts` defines freeway cars, the tram, and park pedestrians as routes over the plan's features; `src/game/census.ts` derives the census rows and the MASS bar from the same snapshot the map shows.

## Scenes

- **Boot → Preloader → City + Hud.** The Preloader loads five core sheets and generates the people, vehicle, and terrain textures. Yard props, crew atlases, and approved artwork load **on demand** the first time a visible lot needs them (`game/src/assets.ts`), so the initial download is a fraction of the full sprite kit. A sheet that fails to fetch (`FILE_LOAD_ERROR`) or to decode (Phaser only logs these, so the loader reconciles pending keys when the queue drains) is recorded in `assetsFailed`, announced once in the HUD, and treated as final: lots that need it are drawn without it rather than rebuilt every refresh waiting for it.
- **CityScene** owns the camera, input, connection, lots, terrain, and actors. **HudScene** is a second Phaser scene drawn in screen space: status plate (connection, freshness, stale), MASS bar, searchable census table, inspect card, navigation D-pad, zoom, home, overview, compass, capture/SVG/motion/follow toolbar, and an interactive minimap that reflects the camera and accepts clicks. Rectangular plaques are tiled KEEP-grain `Scale9Plaque` objects (`game/src/scale9.ts`) so the Canvas fallback matches WebGL. Both scenes read the same snapshot; there is no second city model.
- The only DOM elements are the native repository search field (`#repo-search`, so phone keyboards and assistive technology work) and the visually hidden accessibility mirror (`game/src/a11y.ts`), which exposes status, selection, and census as live text and real buttons and forwards activation back to the scene. Both the Phaser census and the mirror read the same `censusRows()` model; a lot whose refresh carried unmeasured fields shows `~` in the table and a `Data` cell naming the carried fields in the mirror, matching the card's `PARTIAL` line.

## Rendering that keeps detail

- **Terrain** is rasterised once per 8×8 chunk into a texture and cached in a bounded LRU keyed by chunk and plan geometry; chunk images and trees are pooled (`game/src/terrain.ts`). Travelling across the map reuses textures instead of regenerating them.
- **Lots** are built from pooled images and graphics (`game/src/pool.ts`) with a plan signature that excludes freshness fields, so a freshness-only update does not rebuild sprites. Only lots inside the viewport margin hold objects; leaving and returning reuses pooled objects.
- **Actors** live in `ActorSystem` (`game/src/actors.ts`), independent of drawing objects: each actor has a stable id, its own timeline start, and (for ambient routes) a position integrated every step. A sprite is attached only while the actor is on screen; crossing the viewport edge or panning away and back never restarts an animation. Depth is recomputed every frame from the actor's foot position with a bias for drones, so movers occlude and are occluded correctly while they move. Reduced motion pauses stepping.
- There is **no zoom-based detail suppression** and no central-viewport animation restriction: props, crews, and traffic are present at flyover zoom. Culling is purely by viewport bounds. The 1,000-lot fixture and the object bound in `e2e/test_performance.py` guard these paths; `PERFORMANCE.md` states the budgets.
- **Context loss**: the camera, zoom, and selection are saved on `losewebgl`; on `restorewebgl` the Preloader regenerates textures, the scenes restart on the same instances with per-run state reset, and the saved camera and selection are reapplied. Scene shutdown removes renderer listeners, closes the stream, destroys pools, and drops the diagnostics handle.

## Interaction semantics

Selection is one state owned by CityScene and mirrored to the HUD and accessibility layer. Closing the inspect card clears selection and stops following. `F` follows a named actor on the selected lot (a drone, carrier, or crew member — the HUD names which) and any direct camera input (drag, keys, D-pad, wheel) stops following and cancels a running pan. Selection persists across live updates to the lot.

Camera gestures use Phaser world coordinates: drag, wheel, keyboard, touch pan/pinch, search, lot jumps, minimap click, and follow. Browser tests exercise input against the production build, including mobile emulation. `window.__AXP` exposes read-only diagnostics (counts, frame times, selected lot, actor timelines, construction stage, HUD hit points) for the browser suite.

Primary engine documentation: [Phaser cameras](https://docs.phaser.io/phaser/concepts/cameras) and [Phaser 4 rendering](https://phaser.io/tutorials/phaser-4-rendering-concepts).
