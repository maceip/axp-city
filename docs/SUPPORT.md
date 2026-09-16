# Browser and device support

The city is a Phaser 4.2.1 application. Before Phaser is loaded, `game/src/support.ts` feature-detects the browser and picks one of three outcomes:

| Outcome | When | What the visitor sees |
| --- | --- | --- |
| **WebGL renderer** | `webgl2` or `webgl` context can be created | The full city with GPU rendering. |
| **Canvas renderer** | No WebGL, or `?renderer=canvas` | The same city drawn by Phaser's Canvas renderer. Slower; the boot card says so. Every feature (actors, construction, HUD, exports) works. |
| **Unsupported screen** | No canvas at all, or no `fetch`/`EventSource`/`Promise`, or the engine throws while starting | An explicit error card (`#unsupported`) with the reasons, the user agent, a retry button and a link to this document. No game canvas is created. |

`window.__AXP_SUPPORT` records the decision and reasons; `window.__AXP.driver()` reports the actual GL renderer string once the scene runs.

## Verified configurations

Results are from the automated suite (`e2e/test_support.py`, `e2e/test_city_visual.py`) on the commit named in the pull request. "Verified" means the tests below passed against the production build and the real server; screenshots are kept in `e2e/screenshots/`.

| Configuration | Status | Evidence |
| --- | --- | --- |
| Chromium (Playwright build), Linux, WebGL via SwiftShader (software) | Verified | Full suite, `desktop.png`, `performance.json` (software profile) |
| Chromium, Linux, Canvas renderer (`?renderer=canvas`) | Verified | `test_canvas_renderer_fallback_draws_the_same_city`, `canvas-fallback.png` |
| Chromium with canvas disabled (unsupported browser) | Verified | `test_unsupported_browser_gets_an_explicit_error_screen`, `unsupported.png` |
| WebGL context loss and restore | Verified | `test_webgl_context_loss_recovers_camera_and_selection`, `context-restored.png`; camera, zoom and selection survive |
| Emulated phone (390×844, DPR 2, touch): tap, d-pad, pinch, bottom-sheet card, native keyboard | Verified | `test_mobile_tap_dpad_pinch_and_layout`, `mobile.png`, `mobile-inspect.png` |
| Resize and orientation change (900×1200, 1200×700, 600×900) | Verified | `test_resize_and_orientation_relayout_the_hud`, `resize-narrow.png` |
| Chromium, hardware GPU | Verified only when the suite runs on a GPU machine; the report's `driver` field says which | `performance.json` |
| Hosted Azure Playwright workspace browsers | Harness ready (`e2e/conftest.py` connects with `PLAYWRIGHT_SERVICE_URL` + `PLAYWRIGHT_SERVICE_ACCESS_TOKEN`) | Runs once the workspace access token is provided; the workspace rejects anonymous connections with 401 |
| Firefox, Safari (desktop) | **Not verified** | No automated run yet; Phaser 4 supports both, but this game's behaviour there is unproven |
| Physical iPhone, physical Android | **Not verified** | Emulated touch only; no device lab run has been performed |

## Keyboard and assistive technology

- Every HUD action has a keyboard path: `/` search, digits jump to lots, `C` census, `F` follow, `M` reduced motion, `Esc` clears, WASD/arrows pan, `+`/`-` zoom.
- `game/src/a11y.ts` mirrors status, the selected lot and the census into a visually hidden live region (`#a11y`) with real buttons, so screen readers announce state changes and can select repositories.
- Reduced motion (`M` or the HUD button) freezes crews, traffic and weather; the setting is announced.

## Limits

- Canvas mode is a compatibility path: expect lower frame rates on large cities. Performance budgets apply to WebGL on hardware only (see `PERFORMANCE.md`).
- Weather and ambient actors are simulated locally in each browser; only the map, lots and construction timestamps are shared. Two visitors see the same city, not identical traffic positions.
- Support claims above are limited to what the suite exercised. Add a row only with a passing run and its artifact.
