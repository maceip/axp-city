# City renderer engine decision

**Date:** 2026-09-15  
**Question:** Redo the isometric city renderer with melonJS, Phaser, or Bevy (`bevy_ecs_tilemap` + [`bevy_ecs_tiled`](https://adrien-bon.github.io/bevy_ecs_tiled/))?  
**Decision:** **Phaser 4.** Keep the TypeScript ingest/parser. Do **not** author the city in Tiled. Revisit Bevy only if the map becomes a native/WASM sim at tens of thousands of live lots.

This is the render-layer decision. Parser semantics stay in [`docs/PARSER.md`](PARSER.md). Screen language stays in [`docs/AXP-UX-SCREENS.md`](AXP-UX-SCREENS.md).

---

## 1. What we actually have

The pipeline is already split correctly:

```
repos.txt → ingest/ → parser/ → CityLot[] → render/ → out/city.html
```

City logic lives in the parser. Render is a **stamp-and-project SVG scene**, not a game engine:

| Piece | Today |
| --- | --- |
| Projection | Classic 2:1 isometric (`src/render/iso.ts`: 72×36) |
| Lots | Dual-plot, **fixed footprint**, sticky addresses (`placeLots` is a 4-column grid) |
| Buildings | Irregular PNG stamps from three catalog sheets (IDs 01–50), scaled by star band |
| Ground / roads | More irregular stamps from `v5-ground-tiles-kit`, eased onto diamonds |
| Motion | SMIL sprite-sheet clips on crew / drones / street walkers |
| Camera | Inline JS mutating the SVG `viewBox` (pan, wheel zoom, WASD, click-to-fly) |
| Overlay | HTML hover tag + lot card; click is meant to leave the map for chat/Hunt |
| Live data | Webhook catcher exists (`docs/WEBHOOKS.md`); the SVG page does not consume it |
| Scale in hand | 12 demo lots. Design already talks about **1000-repo readability** and a growing platform atlas |

That last row is why the SVG path has to die. It paints the **entire** city, including offscreen forest and every SMIL walker, into one DOM tree. There is no frustum cull, no LOD, no chunking, and no cheap way to append a new repo lot without rewriting `city.html`.

The product is also **not a Tiled level**. Lots are generated from GitHub metrics and must keep sticky geography as the city grows. Tiled is a possible *art* tool for ground tiles. It is the wrong *source of truth* for the city.

---

## 2. What the next renderer must do

From the locked UX (flyover → district → porch → chat) plus the growing-city requirement:

1. **Keep `CityLot` as the contract.** Ingest never paints. Render never special-cases repo names. Parser owns band, yard, crew, drones.
2. **Web-first.** The map sits in an HTML stage (`demo.glint.sh/city`), with DOM overlays and click-through to chat / Hunt. Native desktop is not a current job.
3. **Two visual classes, not one tile grid.**
   - Ground / roads / pads: repeating isometric tiles (once recut).
   - Buildings, yard props, crew, drones: **oversized sprites** with iso depth sort. The 50 building boxes in `src/render/sprites.ts` are not 72×36 cells.
4. **Viewport culling + LOD.** Flyover: dim lots, heat, silhouettes. Neighborhood: props. Porch: animated crew. Offscreen SMIL is already a non-starter at a few hundred lots.
5. **Grow in place.** New repos spawn at a stable address; webhooks mutate yard state. Reloading a giant TMX/world file on every ingest is the wrong loop.
6. **Stay inside the current TypeScript repo** unless the engine gain clearly pays for a second language, WASM payload, and HTML-bridge.

Target bands to design against (not a promise of one mesh for all of GitHub):

| Band | Lots on screen / in memory | What must work |
| --- | ---: | --- |
| Demo | ~12 | What we have |
| Community atlas | ~1 000 | Flyover + neighborhood, live yard pulses |
| Platform atlas | ~10 000 | Chunked districts, aggressive LOD, sparse animation |

A million GitHub repos is a **data** problem (districts, search, fog of far lots), not a “pick the engine that can draw a million tiles” problem. Equal plot footprints already exist so 1000 lots stay readable; do not grow pads with stars or agent count.

---

## 3. The Tiled trap (applies to all three)

[`bevy_ecs_tiled`](https://adrien-bon.github.io/bevy_ecs_tiled/) and melonJS’s `level.load()` are excellent at **authored** maps. Phaser’s Tilemap API is the same family.

AXP City is the opposite:

- Layout is `placeLots(CityLot[])`, not a `.tmx`.
- Growth is “append a lot”, not “open Tiled and paint a new block”.
- Buildings are catalog sprites with measured, irregular boxes — not an isometric tileset.
- `bevy_ecs_tiled` itself [does not support isometric tilesets](https://adrien-bon.github.io/bevy_ecs_tiled/FAQ.html); diamond maps want an **orthogonal** tileset. Our kit is already diamond art.

**Do not generate TMX as the city.** Optionally recut `v5-ground-tiles-kit` into a real isometric tileset (or an orthogonal sheet used on a diamond map) and spawn ground as a tile layer. Spawn every lot as an entity/sprite from `CityLot`.

If we later want a Tiled *world* for hand-authored parks, water, or a personal workshop island, that can sit **under** the generated lots. It must not own them.

---

## 4. Head-to-head

### melonJS

[melonJS](https://melonjs.org/) is the isometric specialist: first-class Tiled (orthogonal / isometric / hex / staggered), ~150–250 KB, zero deps, TypeScript, cameras, sprites, QuadTree, viewport bounds. Closest match if this were a hand-built iso game.

It is the wrong default here:

- The **GPU tile path is orthogonal-only**. Isometric / staggered / hex layers fall back to the CPU per-tile renderer. That is the layer we would use for streets and pads.
- There is no Phaser-class GPU sprite layer for “a skyline of 10k building stamps”.
- Growing cities still need our own chunking, LOD, and `CityLot` → object factory. Tiled’s `level.load()` does not buy that.
- Community and large-iso-world examples are thinner than Phaser’s.

Use melonJS only if we explicitly want the smallest JS engine and will write chunking/LOD ourselves, accepting CPU iso tiles.

### Phaser 4

Phaser 3.50+ already has real isometric `TilemapLayer`s with `IsometricCullTiles`. Phaser **4** (current npm line, MIT, TypeScript defs) adds the two features this map actually needs:

- **`TilemapLayer`** — iso culling, mutable tiles, fine for generated ground. Create from a 2D array; Tiled JSON is optional.
- **`SpriteGPULayer`** — GPU-resident sprites (the docs pitch a million), which maps onto a skyline of building stamps, yard props, and flyover heat better than a tile GID grid.
- **`TilemapGPULayer`** — millions of tiles as one quad, **orthographic only**. Same limitation as melonJS’s GPU tiles. We would not use it for diamond iso ground; we would use `TilemapLayer` + culling, or treat roads as sprites.

Fits the product:

- Stays in this TypeScript repo; canvas drops into the existing `.stage` HTML.
- Hover tags, lot cards, and chat click-through stay DOM (Phaser pointer → repo id → same card we already have).
- Runtime spawn/despawn for new lots and webhook pulses (`push` → crew, `pr_opened` → materials).
- Cameras already do pan / zoom / fly-to; we replace the hand-rolled SVG `viewBox` math.
- Sprite animation replaces SMIL (and can be disabled below a zoom threshold).

Costs:

- Heavier than melonJS (full game framework: physics, audio, scenes we will ignore).
- Iso `TilemapGPULayer` is not a free lunch; large ground still wants **district chunks** (the same pattern Phaser communities already use for big iso maps).
- Art must be recut into a real tileset for ground. Buildings stay as atlas frames.

At 1k–10k lots with LOD, this is the engine that matches “web landscape of GitHub repos” without a second language.

### Bevy + `bevy_ecs_tilemap` + `bevy_ecs_tiled`

[`bevy_ecs_tilemap`](https://github.com/StarArawn/bevy_ecs_tilemap) is the strongest **tile** renderer of the three: one entity per tile, chunked GPU meshes, sparse maps, diamond *and* staggered iso, frustum culling, GPU tile animation. ECS is the right model for “10k lots with `YardKind` / `Crew` / `Heat` components”. WASM is supported.

[`bevy_ecs_tiled`](https://adrien-bon.github.io/bevy_ecs_tiled/) adds Tiled maps/worlds, object→entity hierarchy, custom properties as components, and `TiledWorldChunking` (load maps that overlap a camera rect). That is the right stack for a **Tiled-authored** Bevy game. It is the wrong stack for a GitHub-grown city:

- City layout is generated, not a `.world` file.
- Isometric *tilesets* are unsupported; we would still recut art.
- Hot-reload-from-Tiled is a non-feature for `CityLot[]`.

Bevy’s real costs for *this* product:

- **Web payload.** Trimmed Bevy WASM is still typically ~10–30 MB on disk, several MB transferred. Phaser is hundreds of KB plus our PNGs (which we ship anyway).
- **Two languages.** Parser/ingest/webhooks stay TS; renderer becomes Rust. Every `CityLot` field and webhook event crosses a WASM/JS boundary. HTML overlays work (canvas + DOM) but are more work than Phaser’s pointer events.
- **Compile / CI.** `wasm32`, `wasm-bindgen`, feature flags, Bevy version pinning (`bevy_ecs_tilemap` tracks Bevy 0.19 as of this writing).
- **Overkill for the job of the screen.** The map is orientation + click-through, not a walkable sim. Design already rejected “house is the work surface”.

Revisit Bevy if we need a native client, a real agent-sim on the map, or sustained tens of thousands of *animated* entities with complex ECS systems. In that case use **`bevy_ecs_tilemap` programmatically** (chunked ground + sprite lots), not `bevy_ecs_tiled` as the city.

---

## 5. Decision

| Criterion | melonJS | Phaser 4 | Bevy + tilemap/tiled |
| --- | --- | --- | --- |
| Same TS webapp, HTML overlays | Strong | **Strong** | Weak (WASM + bridge) |
| Generated `CityLot[]` (not Tiled) | Possible | **Natural** | Possible; tiled crate fights this |
| Irregular building sprites | Sprites | **`SpriteGPULayer` + y-sort** | Sprites + ECS |
| Diamond iso ground | CPU tiles | `TilemapLayer` + iso cull | Chunked GPU tiles (best) |
| 1k sticky lots + live pulses | DIY | **Fits** | Fits, expensive to host on web |
| 10k flyover LOD | DIY | **District chunks + GPU sprites** | Best if we pay WASM |
| Growing city (spawn, don’t reshuffle) | Runtime objects | **Runtime objects** | Runtime entities; don’t bake TMX |
| Bundle / load on `demo.glint.sh` | Smallest | **Acceptable** | Largest by far |
| Team / repo today | JS | **JS/TS** | New Rust crate |

**Pick Phaser 4** for the engine redo.

Do not pick melonJS unless we later decide Phaser is too much framework *and* we are willing to own iso chunking on the CPU tile path.

Do not pick Bevy/`bevy_ecs_tiled` for this web atlas. Keep Bevy in mind as a later native/WASM sim backend that would consume the same `CityLot[]` JSON, not as the next `src/render`.

---

## 6. How to redo `src/render` on Phaser (without boiling the ocean)

Preserve the contract: `parseCity(metrics) → CityLot[]` is the only input.

1. **Recut ground.** Slice `v5-ground-tiles-kit` into a tileset with a stable GID for grass, dirt, dual-plot pad, road pieces. Stop easing irregular stamps onto diamonds. Buildings 01–50 stay as sprite frames (existing `BUILDING_SPRITES` boxes can become a TexturePacker/atlas JSON).
2. **Procedural map, not TMX.** `placeLots` still assigns world cells. Fill a `Tilemap` from those cells (pads + street runs). Forest becomes a sparse sprite layer or a cheaper repeating ground beyond the developed island — not one SVG stamp per tree.
3. **One game object family per lot.** Sprite (building) + optional prop sprites + optional animation. `data.repo = fullName`. Depth = `x + y` (same sort key we use now). Quiet lots: tint/alpha, no animation.
4. **LOD by camera zoom.**
   - Flyover: buildings + heat only (`SpriteGPULayer` is the point).
   - Neighborhood: yard props.
   - Porch: crew/drone animations, street walkers.
5. **Camera.** Replace `html.ts` viewBox script with Phaser camera + the same gestures (drag pan, wheel zoom, WASD, double-click reset, click fly-to). Clamp to world bounds including a small wild apron.
6. **DOM stays DOM.** Keep `#hover-tag` / `#lot-card`; Phaser only reports `repo` + screen position. Click-through still leaves the map.
7. **Live updates.** `GET /events/stream` applies to the lot object (show/hide materials, start/stop crew). Do not re-parse the whole city on every push.
8. **Tests.** Parser tests unchanged. Replace SVG string asserts in `test/render.test.ts` with “placement + atlas frame + yard flags” unit tests. Keep Playwright e2e for pan/zoom/click, pointed at the canvas stage.

Out of scope for the first engine cut: physics, audio, Tiled worlds, walkable characters, personal-atlas districts (still an open UX thread).

---

## 7. What we are not deciding

- Personal workshop vs platform grid (open in the UX record).
- Whether far lots fog or stay as cold pads.
- Exact district chunk size (tune once 1k fixtures exist).
- Recutting crew sheets that are not isometric (`player-repo/` 3/4 human poses).

---

*End of engine decision. Next implementation step is a Phaser 4 `src/render` that consumes `CityLot[]` and drops into `out/city.html`, leaving ingest and parser untouched.*
