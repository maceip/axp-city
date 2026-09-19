> Historical repository-city documentation. The active core workshop is specified in [CORE-ENGINE.md](CORE-ENGINE.md); claims and measurements below apply to the previous experience.

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
- the retained heap (after a collection, Chromium via CDP — see the soak section for why `performance.memory` is not used) after the second lap is within 35 % (+16 MB) of the first lap's peak; the city does not change size here, so any growth would be a leak.

Latest software run (Chromium 153, SwiftShader, this branch): objects plateau at 1,243 after the first lap and stay there; terrain cache holds at 96 while `generatedChunks` keeps rising (52 → 260) because a lap visits more than 96 chunks, so revisited ground is re-rasterised rather than kept — bounded GPU memory was chosen over re-rasterisation cost; textures plateau at 148; two lazy sheets requested (≈14 MB decoded budget in total). Retained heap with the meter (run of 2026-09-16, textures 141 → 185): 11.8 MB at the start, 12.1 → 12.7 → 13.1 → 12.6 MB over the first lap, 12.7 → 14.0 → 13.4 → 12.8 MB over the second, 12.6 MB at the end — the quantised `performance.memory` figure read 54.2 MB at every sample.

### Soak session (sustained use with live updates)

`test_soak_session_with_live_updates_keeps_scene_state_bounded` keeps one page alive for `CITY_SOAK_SECONDS` (60 s in CI) of everything at once: every 5 s cycle a metrics update is delivered through a signed webhook and the test waits until the new star count is in the client's plan; every fourth cycle an administrator enrolls a new repository, so several construction sites run concurrently; and the whole time the camera travels on held keys, zooms in and out, selects a different lot and periodically opens and closes the census. `window.__AXP.diagnostics()` is sampled every cycle into `e2e/screenshots/soak.json`, and at the end each enrolled lot is framed and `window.__AXP.drawn()` is read for it.

Required: no page errors; the stream reports `connected` at every sample; the client revision advanced by at least one per update and enrollment; every enrolled lot is drawn (under construction or complete); objects within the pools and terrain cache within capacity at every sample; actors, textures and sheets plateau (the second half may not out-grow the first beyond what the new lots explain); retained heap may grow by at most 0.5 MB per enrolled lot plus 8 MB over the run where the browser lets it be measured.

**How the heap is measured.** `performance.memory.usedJSHeapSize` is not usable for this: Chromium quantises it and refreshes it only about every 20 minutes, so a 60-minute soak that grew the city from 8 to 123 lots recorded 42.6 MB for 30 minutes and then a single step to 149.7 MB — one bucket change, no trend, and a figure that includes uncollected garbage. Both soak and sustained-travel tests therefore take the heap through CDP in Chromium (`HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage`): the retained heap after a collection, sampled every cycle (`heapBytes` in the reports; the quantised reading is kept beside it as `heapQuantised`). Firefox and WebKit expose no equivalent and the reports carry `null` there.

1,800 s local run with the retained-heap meter (Chromium 153, SwiftShader, `CITY_SOAK_SECONDS=1800`, 2026-09-17, this branch): 360 cycles, 360 webhook updates and 90 enrollments (8 → 98 lots), no page errors, `connected` at all 361 samples, revision 1 → 451 (one per update and enrollment), every one of the 90 enrolled lots drawn `complete` when framed at the end. Objects 413 → 1,161 (≈8 per lot, well inside the 2,700 pool) and actors 30 → 408 (≈4.2 per lot; 131 drawn at the last sample) grow with the lots only; the terrain cache sits at its 96 capacity and dips (to 43–71) whenever an enrollment changes the block geometry and the ground is re-rasterised; textures 107 → 207 with the same dips (178–207 through the second half); sheets 6 → 7. Retained heap 8.3 MB → 21.8 MB (peak 21.9), a straight line against the city's size — 8.31 + 0.136 MB per lot fits every sample — and the quantised `performance.memory` figure showed exactly one step in the whole half hour (42.6 MB for the first 19 minutes, 82.4 MB afterwards). Enrollments and updates are locked together in this scenario (one per four cycles), so this run alone cannot say whether any of the growth follows the updates rather than the lots. `CITY_SOAK_ENROLL_EVERY=0` runs the same scenario without enrollments (updates, travel and HUD use on a city of constant size) to separate the two; that run was started but stopped before it completed, so the per-update share is not yet measured — the 0.5 MB-per-lot budget the test enforces covers the whole observed growth either way.

600 s local run with the retained-heap meter (Chromium 153, SwiftShader, `CITY_SOAK_SECONDS=600`): 120 cycles, 120 updates, 30 enrollments (8 → 38 lots), retained heap 8.5 MB → 13.6 MB, i.e. ≈0.17 MB per enrolled lot, flat between enrollments (9.6 → 10.1 → 9.6 → 9.8 MB across the first two minutes) while `performance.memory` read 42.6 MB at all 121 samples; objects 413 → 843, actors 30 → 162, terrain cache at its 96 capacity, textures 107 → 203, sheets 6 → 7.

Earlier 300 s local run (Chromium 153, SwiftShader, this branch, `CITY_SOAK_SECONDS=300`): 60 cycles, 60 webhook updates and 15 enrollments, no page errors, `connected` at all 61 samples, revision 1 → 76 (one per update and enrollment). Objects 377 → 623 and actors 30 → 100 grow only with the 15 new lots (a lot carries ≈4 objects and ≈4–5 actors of its own) and are flat between enrollments; the terrain cache reaches its capacity of 96 and stays there except for two dips (to 55) where an enrollment grew the city's block geometry and the ground was deliberately invalidated and re-rasterised — visible as textures 174 → 133 → 178; sheets stayed at 6 (the kit was loaded in the first cycle); 13 of the 15 lots finished construction inside the run and the last two were drawn at `finishing` and `cladding` when framed. Chromium's `performance.memory` reading stayed at 42.6 MB throughout (quantised; see above for why it is no longer the measurement). The 60 s CI run shows the same shape at a smaller scale (objects 377 → 493, actors 30 → 53, three enrollments). The camera does not cover a lap of the 8-lot fixture, so this scenario proves lifecycle and update behaviour; distance-driven memory is the sustained-travel test above.

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
- Assets: seven core sheets (buildings S/M/L, ground, civic, HUD, wild trees) load before the first frame; yard props, crew atlases and approved artwork load on first use (`game/src/assets.ts`). Measured, not asserted from the manifest: `test_thousand_lots_fully_featured_meets_its_profile_budget` records every sprite response until the boot card hides as `bootPayload` in `performance.json` — 4.47 MB downloaded before the city appeared (the seven core sheets plus the two lazy sheets the first visible lots asked for) against a 19.8 MB kit of 20 referenced sheets, i.e. 22.6 %; the test fails above 6 MB or half the kit.

The 1,000-lot fixture measures rendering. It does not establish 1,000 live GitHub integrations or many simultaneous visitors; server load is a separate concern covered by `/api/city/status` and the delivery queue metrics.

## Server: delivery burst (`test/load.test.ts`)

`npm test` includes a sustained-load case against the real HTTP server, SQLite queue and worker: 200 lots, 600 concurrent signed deliveries (two ids per repository plus one exact duplicate), a resolver that takes 5–15 ms, two SSE subscribers attached throughout, `coalesceMs: 0` so every delivery is a refresh. Required: every delivery acknowledged after persistence (202 new, 200 duplicate, never 5xx or 429 at the configured ceiling), duplicates stored once, the backlog drained with no failures, every lot refreshed and persisted, `PRAGMA integrity_check` ok, both subscribers still connected and having received every lot mutation, heap growth under 64 MB.

Latest run on the Cloud Agent VM (Node 24, two cores): 600 deliveries accepted in ≈2.5 s, drained in ≈9 s, 400 resolver calls, heap +49 MB before GC. The worker processes deliveries **one at a time**: throughput is bounded by GitHub latency (at ~500 ms per real refresh a 400-refresh backlog takes ~3–4 minutes), which the 10 s per-repository coalescing window and GitHub's own 5,000 requests/hour ceiling make acceptable for a city of hundreds of lots but which is the limit to raise first if enrollment grows past that. A stop request lets the delivery in hand finish before the store closes; anything still queued is re-queued on the next start.
