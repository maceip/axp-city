> Historical repository-city documentation. The active core workshop is specified in [CORE-ENGINE.md](CORE-ENGINE.md); claims and measurements below apply to the previous experience.

# Browser and device support

The city is a Phaser 4.2.1 application. Before Phaser is loaded, `game/src/support.ts` feature-detects the browser and picks one of three outcomes:

| Outcome | When | What the visitor sees |
| --- | --- | --- |
| **WebGL renderer** | `webgl2` or `webgl` context can be created | The full city with GPU rendering. |
| **Canvas renderer** | No WebGL, or `?renderer=canvas` | The same city drawn by Phaser's Canvas renderer. Slower; the boot card says so. Every feature (actors, construction, HUD, exports) works. |
| **Unsupported screen** | No canvas at all, or no `fetch`/`EventSource`/`Promise`, or the engine throws while starting | An explicit error card (`#unsupported`) with the reasons, the user agent, a retry button and a link to this document. No game canvas is created. |

`window.__AXP_SUPPORT` records the decision and reasons; `window.__AXP.driver()` reports the actual GL renderer string once the scene runs. A sprite sheet that cannot be fetched *or decoded* is reported through `window.__AXP.diagnostics().assetsFailed` and a HUD toast; lots that need it are drawn without it instead of waiting forever.

Running the suite in another engine locally: `CITY_LOCAL_BROWSER=1 CITY_BROWSER=firefox|webkit python3 -m pytest e2e/test_city_visual.py e2e/test_support.py e2e/test_exports.py` (after `python3 -m playwright install --with-deps chromium firefox webkit`). CI `browser-local` installs those browsers on the runner and runs all three engines on every push. Azure Playwright Workspaces is optional.

## Verified configurations

Results are from the automated suite (`e2e/test_support.py`, `e2e/test_city_visual.py`) on the commit named in the pull request. "Verified" means the tests below passed against the production build and the real server; screenshots are kept in `e2e/screenshots/`.

| Configuration | Status | Evidence |
| --- | --- | --- |
| Chromium (Playwright build), Linux, WebGL via SwiftShader (software) | Verified | Full suite, `desktop.png`, `performance.json` (software profile) |
| Chromium, Linux, Canvas renderer (`?renderer=canvas`) | Verified | `test_canvas_renderer_fallback_draws_the_same_city`, `canvas-fallback.png` |
| Chromium with canvas disabled (unsupported browser) | Verified | `test_unsupported_browser_gets_an_explicit_error_screen`, `unsupported.png` |
| WebGL context loss and restore | Verified | `test_webgl_context_loss_recovers_camera_and_selection`, `context-restored.png`; camera, zoom and selection survive, and a pan that was still gliding when the context went finishes first so the restored scene lands at its destination. Skipped where the browser gave no WebGL context |
| Emulated phone (390×844, DPR 2, touch): tap, d-pad, pinch, bottom-sheet card, native keyboard | Verified | `test_mobile_tap_dpad_pinch_and_layout`, `mobile.png`, `mobile-inspect.png` |
| Resize and orientation change (900×1200, 1200×700, 600×900) | Verified | `test_resize_and_orientation_relayout_the_hud`, `resize-narrow.png` |
| Chromium, hardware GPU | Verified only when the suite runs on a GPU machine; the report's `driver` field says which | `performance.json` |
| Hosted Azure Playwright workspace browsers | Optional; harness ready (`e2e/conftest.py` connects only with URL **and** `PLAYWRIGHT_SERVICE_ACCESS_TOKEN`) | Not required for in-env proof. URL without a token fails closed. `CITY_LOCAL_BROWSER=1` is the Cloud Agent / CI `browser-local` path |
| Firefox (Playwright build), Linux, WebGL | Verified | `CITY_BROWSER=firefox`: `test_city_visual.py`, `test_support.py`, `test_exports.py` all pass, including phone emulation with a DOM `TouchEvent` pinch |
| Firefox (Playwright build), Linux, no WebGL → Canvas fallback | Verified | Headless Firefox on a GitHub-hosted runner refuses a WebGL context; the CI `browser (firefox)` leg therefore runs the whole suite on the automatic Canvas fallback, with `__AXP_SUPPORT.reasons` naming the cause. The same path is checked in Chromium with `CITY_DISABLE_WEBGL=1` |
| WebKit (Playwright build), Linux, WebGL | Verified | `CITY_BROWSER=webkit`: same three modules pass. This is WebKitGTK/WPE, **not** Safari on macOS or iOS; Safari's Metal-backed WebGL and iOS touch handling remain unproven |
| Sprite sheets that fail to fetch or decode | Verified | `test_failed_sprite_sheets_are_reported_and_the_city_still_draws`, `failed-sheets.png`: the failure is listed in `assetsFailed`, nothing stays in flight, the lot is still drawn |
| Safari (macOS), physical iPhone, physical Android | **Not verified** | Emulated touch and Linux WebKit only; no device lab or macOS run has been performed |

## Keyboard and assistive technology

- Key handling is frame-rate independent: Phaser dispatches queued DOM key events as they arrive but clears the queue only on the next game step, so on a slow device a keyup could re-dispatch the keydown before it. `CityScene` acts on each DOM event once; this is exercised by the SwiftShader CI leg, where the effect reproduces.

- Every HUD action has a keyboard path: `/` search, digits jump to lots, `C` census, `F` follow, `M` reduced motion, `Esc` clears, WASD/arrows pan, `+`/`-` zoom.
- `game/src/a11y.ts` mirrors status, the selected lot and the census into a visually hidden live region (`#a11y`) with real buttons, so screen readers announce state changes and can select repositories.
- Reduced motion (`M` or the HUD button) freezes crews, traffic and weather; the setting is announced.

## Limits

- Canvas mode is a compatibility path: expect lower frame rates on large cities. Performance budgets apply to WebGL on hardware only (see `PERFORMANCE.md`).
- Weather and ambient actors are simulated locally in each browser; only the map, lots and construction timestamps are shared. Two visitors see the same city, not identical traffic positions.
- Support claims above are limited to what the suite exercised. Add a row only with a passing run and its artifact.
