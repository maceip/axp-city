# Phaser reconstruction handoff

Prepared September 16, 2026. Repository: `maceip/axp-city`.

## Status

**Implemented on the single Phaser 4 + Node origin city.** This file is the original request and audit, not a pending second client or a second engine.

- [PR #3](https://github.com/maceip/axp-city/pull/3) made Phaser 4 the only live city client.
- [PR #4](https://github.com/maceip/axp-city/pull/4) implemented the 11 items and audit findings A–I.
- [PR #5](https://github.com/maceip/axp-city/pull/5) (`7f4d186`) is the reconstruction follow-up already on `main`: multi-engine verification, low-FPS input, asset-failure reporting, HUD census and phone sheets, `GITHUB_API_URL`, storage-failure readiness, graceful worker stop, `SchemaTooNewError`, and the shared live protocol. Later [PR #6](https://github.com/maceip/axp-city/pull/6)–[#9](https://github.com/maceip/axp-city/pull/9) restyled tiles, added Trending City, and replaced the stretch `NinePanel` leftover with tiled `Scale9Plaque` (`game/src/scale9.ts`). There is no SVG live city; SVG is an export of the shared plan.

Live contracts: [ENGINE.md](ENGINE.md), [CITY.md](CITY.md), [RECONSTRUCTION-STATUS.md](RECONSTRUCTION-STATUS.md). Remaining limits (hardware GPU, physical devices, production deploy secrets) stay in the status document. They are not a second product.

The rest of this file is the original 16 September request, kept as history.

## Original purpose (16 September 2026)

The user requested a complete written handoff, pushed to the remote, followed by an immediate stop to all work. This document recorded the requested implementation and the additional audit findings.

Audited baseline: `33de3b59a403a2c83a6f7dacf06e07dd9515d390`, on `main`. Immediately before writing this document, a fetch confirmed local `HEAD` and `origin/main` were identical. The existing Phaser recovery was merged through [PR #3](https://github.com/maceip/axp-city/pull/3). Earlier in that session, the public `/healthz` reported that same revision, and `/api/city` contained 14 lots sourced from GitHub GraphQL. The handoff itself made no application or deployment changes.

The engine consolidation was already real: one Phaser 4.2.1 city client and its Node server live in this repository. The prior completion claim overstated feature parity, performance verification, and operational completeness. Several features were omitted or simplified, and some remaining infrastructure was treated as more complete than the evidence supported.

## Working boundaries

- Build on freshly fetched current `main` in `maceip/axp-city`, verifying remotes and status first. The local folder is `/Users/mac/AXP-city-sprites`.
- Preserve existing city data, lot addresses, useful assets, and Git history. Preserve unrelated untracked files: `Screenshot 2026-09-12 at 22.56.07.png`, `ai-game-studio` (a separate project symlink), and `assets/city-sprites/v8-wild-trees-k1.png.bak.png`.
- Keep one live Phaser application, one canonical city model, and one repository. Server improvements can remain in the same application and deployment.
- Reimplement incomplete systems cleanly. Use historical versions to establish expected features and appearance; do not replace current `main` with an old implementation.
- Read `AGENTS.md`. Keep credentials on the server. Preserve unrelated services and Caddy sites.
- The user has requested this document and a stop. **This handoff is not an instruction to begin further implementation in this session.**

Historical references:

- `c3bf6b07cb7bc7da6e690203f5769e1a5192413a`: city before the Phaser recovery, including the SVG city/HUD work.
- `8ceef63348b87f54427c4c4a8dc98c539bf21552`: original Phaser branch implementation.
- `33de3b59a403a2c83a6f7dacf06e07dd9515d390`: merged recovery and the baseline audited here.
- Local recovery refs were retained: `recovery/pre-phaser-local-20260916`, `recovery/pre-phaser-main-20260916`, and `recovery/original-phaser-20260916`. The historical commits are also reachable through the merged history.

## The 11 requested implementations

### 1. Complete city animation and decoration

Implement moving freeway cars, an operating tram, park pedestrians, detailed park decoration, and distinct walking, working, carrying, and waving behaviors. Implement a staged construction sequence driven by the server's construction timestamp so visitors see consistent progress.

The current recovery omitted moving freeway cars, the tram vehicle, and park pedestrians. It simplified park decoration and construction. Several human worker actions became one generated walking animation. Earlier `src/render/features.ts`, `humans.ts`, and `construction.ts` provide behavioral and visual references.

Acceptance: demonstrate all restored features in the running Phaser scene, including quiet/active human and bot lots and a complete construction transition. Verify layering and movement across neighboring lots, not just a clean still image.

### 2. Complete Phaser interface

Implement the MASS bar, searchable census table, repository search, inspect cards, navigation controls, compass, and interactive minimap in Phaser. Every display must read the same city state. Preserve the intended meanings of existing indicators rather than inventing replacements silently.

The current HUD is HTML/CSS, the minimap is a separate 2D canvas, and MASS/census were omitted. Native text entry needed for mobile keyboards or accessibility must be explicitly documented. It must not become another city implementation.

Acceptance: all advertised controls work with mouse, keyboard, and touch; users can find and inspect every repository; UI remains usable on small screens. Include keyboard focus and accessible repository information in the design.

### 3. Rendering that preserves visible detail

Keep visible loading zones populated and visible actors animated across the screen. Preserve actor identity, position, and animation timing independently of drawing objects so leaving and returning does not restart activity.

Replace the current zoom-under-72% detail suppression and central-64%-of-viewport animation restriction with measured optimization: object reuse, shared textures, cached terrain, and offscreen drawing suppression. Optimize artwork and cache it; load assets as needed to reduce the roughly 15 MB upfront art requirement. Any remaining quality reduction must be explicit.

Acceptance: pan away and return, cross viewport edges, zoom, and receive updates without inappropriate disappearance, frozen visible actors, or animation resets. Measure memory and loading behavior during sustained travel.

### 4. Measured performance requirements

Establish explicit frame-time and loading budgets on named desktop and mobile hardware before optimizing. Measure the fully featured game during panning, zooming, following actors, construction, and live updates, including a representative 1,000-lot city.

The recovery loosened CI median/p95 frame-time limits from 40/100 ms to 750/1,500 ms for software rendering after failures. The merged baseline's CI artifact recorded median 283.3 ms and p95 450 ms, approximately 3.5 FPS by median interval. A local run recorded median 33.2 ms, about 30 FPS. **Both used SwiftShader software rendering.** An older local artifact's `hardware performance` label was inaccurate; its driver field identifies SwiftShader.

Acceptance: distinguish software-rendered correctness checks from real hardware performance gates. Publish actual driver, hardware, scene, feature settings, measurements, and budgets. A relaxed CI pass is not performance proof. The 1,000-lot fixture does not establish 1,000 live GitHub integrations or many simultaneous visitors.

Evidence: [baseline main CI](https://github.com/maceip/axp-city/actions/runs/35080842425), `e2e/test_city_visual.py`, and its `performance.json` artifact.

### 5. Browser and device support

Verify Chrome, Firefox, Safari, physical iPhone and Android devices, and hardware GPU rendering. Exercise touch, keyboard entry, resizing, orientation changes, graphics-context recovery, and sustained use. Implement and test Phaser Canvas fallback where appropriate; library support alone does not prove this game's compatibility or performance.

Current evidence covers Chromium and simulated mobile touch. The game explicitly requests WebGL. Physical devices and the other browsers remain unverified.

Acceptance: publish supported configurations and limitations, with actual tests on the named devices. A working unsupported-device/error screen is also required.

### 6. Reliable live GitHub integration

Implement GitHub App event handling for participating repositories, with reconciliation for missed changes and polling for repositories without authorized event access. Immediate events for arbitrary repositories require access granted by their owners; do not promise universal instant updates.

Show connection status, last successful GitHub refresh, and stale/error state separately. Make fixture mode explicit and normal development's live-data configuration clear. Define repository enrollment/discovery as well as refresh of already enrolled repositories.

Current behavior polls existing lots every 15 minutes when a GitHub token exists. The `Live city` badge primarily indicates connection/mode, not freshness. `npm run dev` passes `--offline`. During recovery, a webhook was configured for `maceip/axp-city`; installation for every represented repository was not performed.

Acceptance: prove an actual authorized GitHub change reaches two browser sessions, a missed change is recovered, and outages remain visibly stale rather than being presented as fresh data.

### 7. Complete production configuration and deployment

Use dedicated application credentials with limited permissions. Configure and verify authorized administrative additions. Automate deployment of tested commits, public revision verification, application health checks, and rollback that preserves city data.

The deployed startup wrapper currently reuses the deployment user's GitHub CLI credential. Runtime inspection found `GITHUB_TOKEN` and `GITHUB_WEBHOOK_SECRET` present but `CITY_ADMIN_TOKEN` absent, so manual additions through the admin API are disabled. Deployment is currently manual. The deploy script's rollback covers its internal health failure path, not every later proxy/public/browser failure.

Acceptance: exercise administrative authorization, deployment, failure rollback, and the public browser path. Keep secrets out of source, artifacts, browser code, and logs.

### 8. Durable storage and event processing

Implement transactional storage for city state and pending jobs. SQLite is a reasonable candidate for the current single-server deployment; a database choice does not itself prove durability. Persist authenticated deliveries before acknowledging them, process them with retries and duplicate protection, and recover missed deliveries.

Correct rate limiting behind the trusted proxy without accepting spoofed client identity. Verify restart/crash recovery, sustained load, off-host backups, and restoration. Define log retention and resource limits.

The current city store uses a local JSON file and the diagnostic event store uses JSONL. Webhook handling performs upstream work before responding and has no durable retry worker. Behind Caddy, the socket-address rate limiter groups requests under the proxy address. GitHub does not automatically redeliver failures; comments implying automatic retries are misleading.

Acceptance: prove behavior under slow GitHub responses, duplicate and concurrent deliveries, interruption between processing stages, storage failure, server downtime, and a restore to another location. Verify state and delivery handling together.

### 9. Enforced public-data boundaries

Verify repository visibility before publishing city information or events. Handle a repository becoming private or losing authorization by withdrawing its public data. Apply the publication policy to snapshots, live streams, event history, and exports.

The current city and event feeds are public, and ingestion does not enforce exclusion of private repositories. This is a code-level exposure condition, not a claim that private data was observed leaking during this audit.

Acceptance: private or unauthorized test repositories cannot appear through any public path; public-to-private transitions withdraw the relevant published records.

### 10. Expressive repository rules and complete lifecycle handling

Implement validated, versioned rules for building selection, approved custom artwork, loading-zone layouts, bay counts, and props. Validate layouts against placement constraints. Track repositories by stable GitHub identity so renames and transfers preserve addresses. Define deletion/removal without shifting neighbors.

Current rules support catalog IDs and predefined props. Custom artwork/layouts are capability extensions, not features restored simply by merging an old commit. Current identities are based on repository names. Removal and rename handling are incomplete.

Acceptance: demonstrate each supported rule in actual rendered output, including malformed rules, fallback behavior, rule changes, renames, transfers, and removals. Preserve neighboring lots and construction history.

### 11. Complete export functionality

Implement image capture of the Phaser city, an offline package containing the same game and saved city, and SVG export generated from the shared city plan. Keep SVG generation confined to export functionality.

The recovery removed standalone SVG/HTML map export. `npm run render` currently produces JSON. A Phaser screenshot does not automatically provide an SVG scene or an offline package.

Acceptance: open and inspect the actual exported files, verify the intended saved state, and verify the offline package without network access.

## Additional findings from the read-only audit

These are explicit details missing from the earlier broad list. Integrate them into the relevant items above; they are not a request for a second product or an unrelated rewrite.

### A. GitHub failures can become fresh-looking zero values — reproduced

`src/ingest/github.ts` accepts GraphQL responses containing both data and field errors. `src/ingest/normalize.ts` replaces missing issue/PR fields with zero. The REST path catches failures fetching commits/languages and substitutes zero commits or an empty language map, while marking the result with a new fetch time and GitHub source.

A local mocked-response probe reproduced both paths: a failed GraphQL issues field yielded `openIssues: 0`; REST 503s for commits/languages yielded zero commits and an empty language map as a successful `github-rest` result. No production data was changed for these probes.

Required correction: distinguish unknown/failed fields from measured zero values. Preserve last good values or reject incomplete refreshes, and expose partial/stale state. Cover this explicitly under item 6.

### B. Human/bot activity classification is not trustworthy enough — reproduced/source-confirmed

The GraphQL recent commit count has a date filter, but the `recent` author history requests the latest 15 commits without that filter. Author normalization does not filter `committedDate`. A local probe confirmed an author from a 2020 commit still enters `recentAuthors` and can produce a robot crew for an otherwise currently active lot.

PR authors are sampled (20 in GraphQL; the first 100 in REST). REST recent commit counts are capped at the first 30 results. Bot classification uses account type/login heuristics. That is not proof that code was AI-written, and absence of a detected bot is not proof of exclusively human work.

Required correction: define the exact meaning of crew labels, align activity windows, handle pagination/sampling explicitly, and represent mixed or unknown activity honestly. This belongs in items 1 and 6, before those metrics drive new animations.

### C. Live state, fixture state, and CLI exports are not a single consistent data path — source-confirmed

Live and offline modes default to the same `data/` location. Startup avoids overwriting an existing city, but switching mode can load the other mode's persisted state; subsequent authorized offline refreshes use fixture metrics against that store. Separate data directories and safe mode checks are needed.

The live resolver reads per-repository rules and uses persisted ordering. The CLI render path instead reads `out/metrics.json`, local default rules, and that file's ordering. Consequently it can produce different building choices or addresses from the running city. Running ingest/render also does not automatically enroll newly listed repositories in an already persisted live city.

Required correction: define one canonical snapshot/import/export contract, isolate demo data, and implement explicit enrollment and import behavior. Cover under items 6, 8, 10, and 11.

### D. Stable addresses currently depend on unversioned placement code — source-confirmed design risk

The city store persists lot order, not explicit plot coordinates or a versioned map-layout assignment. `planCity()` recomputes coordinates from that order and current constants/algorithm. Existing append/restart tests pass, but changing the planner or footprint constants during a clean rebuild could move every lot.

The store loader also performs only partial runtime validation and does not reject unknown state versions. Browser snapshot validation checks only a small part of the payload shape.

Required correction: version layout and storage/protocol schemas, preserve or migrate existing assignments explicitly, and test old persisted data and already-open clients across upgrades. This is a concrete migration requirement under items 7, 8, and 10.

### E. The test suite can approve the wrong product — confirmed by test inspection

Browser tests save screenshots but do not compare them with an approved visual result. Several checks inspect data fields rather than proving the rendered output matches those fields. `test/game-plan.test.ts` explicitly requires detailed props/animation to be absent at flyover zoom; that test enshrines a compromise the reconstruction is intended to remove.

The automated browser harness runs fixture mode. The earlier manual live webhook check is useful evidence, but it does not turn those fixture tests into continuous coverage of GitHub ingestion. Follow behavior, complete atlas coverage, accessibility, and long-running scene lifecycle behavior are not established by the current suite.

Required correction: replace outdated acceptance assertions, verify representative visual states and transitions, and add targeted tests for the actual data failures above. Unit counts and screenshots alone must not stand in for feature completeness.

### F. Health, diagnostics, and configuration can mislead operators — source-confirmed

`/healthz` returns `ok: true` with process/build/count information. It does not establish that the client bundle is usable, GitHub refreshes succeed, or persistence remains writable. Several server error paths return generic responses without recording useful error context. There is no demonstrated alerting for stale refreshes or application failures.

The CLI parses `--rate-limit-max` and `--rate-limit-window-ms`, but `runServer()` does not pass those settings to the webhook server. Operationally advertised settings can therefore be ineffective.

Required correction: distinguish liveness from readiness, expose safe actionable diagnostics, verify configuration takes effect, and exercise alerts. Include these under items 7 and 8.

### G. Resource growth and update churn remain — source-confirmed; load impact unmeasured

The event log grows indefinitely, all delivery IDs are retained in memory, and startup reads the whole log. The diagnostic event stream lacks the city stream's buffer guard. Rule size checking occurs after the entire response is read and counts string units rather than bytes. These are specific cases for the retention/backpressure/resource work in item 8.

Every lot refresh commits and broadcasts an update, even without meaningful metric/rule changes. `fetchedAt` participates in the renderer's whole-lot signature, causing object recreation on freshness-only updates. Every HUD update rebuilds the repository option list; visible-lot refresh scans all placements. These are performance suspects under items 3 and 4; their long-run impact was not benchmarked in this audit.

### H. Interaction, accessibility, and shared-world meaning need explicit acceptance

Code-review concerns, not browser-reproduced failures in this audit:

- HUD selection and scene selection are separate. Closing the inspect card clears HUD selection without clearing scene selection/follow state. Define and test the intended behavior.
- `F` chooses the first sprite found on the selected visible lot. It does not identify a specific vehicle or maintain a meaningful vehicle journey.
- Moving sprites keep their initially assigned drawing depth. Check occlusion while actors move behind and in front of neighboring objects.
- Scene shutdown cleans up some resources, but HUD timers/handlers and scene-owned collections need a restart/context-recovery audit.
- There is no reduced-motion setting or demonstrated full keyboard/screen-reader interaction coverage. Rebuilding the HUD in Phaser must preserve accessible functionality deliberately.

Currently the server shares map/lot data and construction timestamps. Weather and ambient actor animation are local to each browser. Identical traffic or pedestrian positions across visitors are not implemented or established by the existing SSE feed. Record the intended scope; do not imply synchronized simulation merely because the map is shared.

### I. Configuration and documentation still contain competing assumptions

Default thresholds/catalog ranges exist in `.city/`, `DEFAULT_RULES`, and older threshold helpers. Old helpers such as `uniquifyBuildingIds()` remain although `parseCity()` no longer uses them; repeated silhouettes are therefore possible. Consolidate the active source of truth and decide how visual variety should coexist with stable appearance and explicit repository overrides.

Webhook comments/documentation imply GitHub will retry failures automatically. That is incorrect. Correct operational documentation along with the implementation, including the misleading older benchmark label noted above.

## Evidence limits and completion standard

The extra audit consisted of source/test review and isolated mocked GitHub response probes. It did not modify the application, update production data, run a new full browser campaign, perform a load test, or establish that every possible defect has been found. Source-level concerns are labeled separately from reproduced problems.

The 11 items and the additional findings must become explicit acceptance requirements. Completion requires the restored features in the actual game, measured performance on named devices, correct data under upstream failures, safe migration of persisted state, and exercised deployment/recovery. Each remaining limitation must be disclosed in the final handoff. A merge or green software-rendered CI alone is insufficient.

References for operational contracts:

- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [GitHub failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)
- [GitHub Apps and integration credentials](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)
- [SQLite appropriate uses](https://www.sqlite.org/whentouse.html)

## Session stop boundary (16 September 2026)

The only new deliverable authorized at the end of that session was this handoff document committed and pushed to the remote. Reconstruction itself landed later in PRs #4 and #5 on the same Phaser 4 city.
