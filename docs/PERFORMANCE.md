# Performance budgets and measurements

Budgets are stated for the **fully featured** game: persistent actors and ambient traffic animating, staged construction, full detail at every zoom, a 1,000-lot city (`e2e/conftest.py::large_server`). They are enforced by `e2e/test_performance.py`, which measures each interaction separately and writes the complete report to `e2e/screenshots/performance.json` on every run, pass or fail.

## Two profiles, chosen from the driver

The browser reports its GL driver through `window.__AXP.driver()` (`WEBGL_debug_renderer_info`). SwiftShader, llvmpipe and Canvas 2D are **software**; anything else is **hardware**. The profile is chosen from that string, never from a CI label. `CITY_PERF_PROFILE=hardware` makes a GPU machine fail loudly if it silently falls back to software.

| Profile | Purpose | First frame | Median frame | p95 frame | Scene objects |
| --- | --- | --- | --- | --- | --- |
| `hardware` | Product performance gate | ≤ 8 s | ≤ 33 ms (30 FPS) | ≤ 80 ms | ≤ 2,600 |
| `software` | Correctness of the same interactions under SwiftShader; **not performance proof** | ≤ 45 s | ≤ 750 ms | ≤ 1,500 ms | ≤ 2,600 |

The object bound catches culling or pooling regressions independently of frame time. Frame intervals come from the scene's `update()` clock, sampled after `resetFrameStats()` for each scenario, so they measure the game loop rather than Playwright's round trips.

## Scenarios measured

1. Idle with actors animating.
2. Pan: pointer drag followed by held-key travel.
3. Zoom out to the flyover distance and back in (full detail is kept at every zoom).
4. Follow a named crew actor (`F`) for two seconds.
5. A new lot enrolled live and under construction, then selected.
6. A live metric update to a visible lot delivered through the webhook queue.

Loading is measured as time from navigation to the first rendered terrain chunk (`first_frame_ms`), plus the wait until on-demand assets settle before sampling starts.

### Sustained travel (memory and loading)

`test_sustained_travel_bounds_memory_textures_and_loading` drives two laps around the 1,000-lot city with held keys (eight 2.5 s legs) and samples `window.__AXP.diagnostics()` after each leg into `e2e/screenshots/sustained-travel.json`: allocated and active scene objects, pooled images, actors, terrain chunks visible/cached/generated, texture count, sheets and decoded bytes requested, in-flight and failed assets, and `performance.memory.usedJSHeapSize` where the browser exposes it (Chromium). The assertions are the invariants the renderer is built on:

- allocated objects never exceed the pools (1,500 images + 400 graphics + 800 actor sprites, plus civics);
- cached terrain textures never exceed the LRU capacity (96) beyond what is on screen — eviction skips on-screen textures and continues past them, so the cache cannot creep after a lap returns to old ground (the GitHub-hosted SwiftShader leg caught it at 105 before this was fixed);
- every sprite sheet is requested at most once and the count stops growing once the kit has been seen;
- textures do not scale with distance travelled;
- the heap after the second lap is within 35 % (+16 MB) of the first lap's peak.

Latest software run (Chromium 153, SwiftShader, this branch): objects plateau at 1,243 after the first lap and stay there; terrain cache holds at 96 while `generatedChunks` keeps rising (52 → 260) because a lap visits more than 96 chunks, so revisited ground is re-rasterised rather than kept — bounded GPU memory was chosen over re-rasterisation cost; textures plateau at 148; two lazy sheets requested (≈14 MB decoded budget in total); heap reading constant at 51 MB (Chromium quantises this figure).

## What the report contains

`performance.json` records: `profile`, the `budget` applied, `driver` (renderer/vendor strings, `software` flag, API), `backend` (hosted Azure Playwright workspace or local Chromium, browser version, SwiftShader flags), `hardware` (harness host, browser platform, `hardwareConcurrency`, `deviceMemory`, DPR, viewport, user agent), `scene` (lots, renderer, Phaser version), `features` toggled, `first_frame_ms`, and per-scenario `frame_ms` (median, p95, samples), object and actor counts.

## Measurements on named devices

| Device / driver | Profile | Result | Source |
| --- | --- | --- | --- |
| GitHub-hosted `ubuntu-latest`, Chromium, SwiftShader (Vulkan, Subzero) | software | Correctness pass; baseline recovery artifact recorded median 283 ms / p95 450 ms (≈3.5 FPS). This is *not* a hardware number. | Baseline CI artifact referenced in `PHASER-RECONSTRUCTION-HANDOFF.md` |
| Cloud build VM (this reconstruction), Chromium 153, SwiftShader | software | See `e2e/screenshots/performance.json` from the latest run for the exact figures | `npm run test:e2e` |
| Named desktop GPU (e.g. Apple M-series, discrete NVIDIA/AMD) | hardware | **Not yet measured.** Run `CITY_LOCAL_BROWSER=1 CITY_PERF_PROFILE=hardware python3 -m pytest e2e/test_performance.py` on the device and commit the report row here. | — |
| Physical phone (iPhone, Android) | hardware | **Not yet measured.** Requires a device run; emulated mobile numbers are not substituted. | — |

Rows are added only from a real run whose `performance.json` is attached to the pull request or release. A green software run in CI is deliberately labelled as correctness, and must never be reported as the product's performance.

## Known cost centres

- Terrain: chunks are rendered once into cached textures (`game/src/terrain.ts`) and reused while panning; a geometry change (new district, feature move) invalidates them.
- Lots: images and graphics come from pools (`game/src/pool.ts`); a lot is rebuilt only when its plan signature changes, and freshness-only updates do not change the signature.
- Actors: all actors advance in `ActorSystem.step()`; only those inside the camera view hold a sprite. Reduced motion pauses stepping.
- Assets: five core sheets load before the first frame; yard props, crew atlases and approved artwork load on first use (`game/src/assets.ts`).

The 1,000-lot fixture measures rendering. It does not establish 1,000 live GitHub integrations or many simultaneous visitors; server load is a separate concern covered by `/api/city/status` and the delivery queue metrics.

## Server: delivery burst (`test/load.test.ts`)

`npm test` includes a sustained-load case against the real HTTP server, SQLite queue and worker: 200 lots, 600 concurrent signed deliveries (two ids per repository plus one exact duplicate), a resolver that takes 5–15 ms, two SSE subscribers attached throughout, `coalesceMs: 0` so every delivery is a refresh. Required: every delivery acknowledged after persistence (202 new, 200 duplicate, never 5xx or 429 at the configured ceiling), duplicates stored once, the backlog drained with no failures, every lot refreshed and persisted, `PRAGMA integrity_check` ok, both subscribers still connected and having received every lot mutation, heap growth under 64 MB.

Latest run on the Cloud Agent VM (Node 24, two cores): 600 deliveries accepted in ≈2.5 s, drained in ≈9 s, 400 resolver calls, heap +49 MB before GC. The worker processes deliveries **one at a time**: throughput is bounded by GitHub latency (at ~500 ms per real refresh a 400-refresh backlog takes ~3–4 minutes), which the 10 s per-repository coalescing window and GitHub's own 5,000 requests/hour ceiling make acceptable for a city of hundreds of lots but which is the limit to raise first if enrollment grows past that. A stop request lets the delivery in hand finish before the store closes; anything still queued is re-queued on the next start.
