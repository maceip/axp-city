# Production browser verification

```sh
npm ci
npm run build
python3 -m pip install -r e2e/requirements.txt
python3 -m pytest e2e -v
```

## Where the browser runs

The suite is written for the **hosted Azure Playwright workspace**. `conftest.py` connects to `PLAYWRIGHT_SERVICE_URL` (with `os`, `runId`, `api-version` query parameters) using `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` as a bearer token and exposes this machine's loopback to the remote browser (`expose_network="<loopback>"`), so every test still starts the real compiled Node server locally with isolated data, rules, and recorded metrics. Optional: `PLAYWRIGHT_SERVICE_OS` (`linux`/`windows`), `PLAYWRIGHT_SERVICE_RUN_ID`.

The workspace rejects anonymous connections with `401 Unauthorized`; without the access token the suite fails fast with that message instead of silently using another browser. `CITY_LOCAL_BROWSER=1` deliberately runs the same suite against a local Chromium (`CITY_SOFTWARE_GL=1` forces SwiftShader, `CITY_DISABLE_WEBGL=1` forces the Canvas path, `HEADED=1` shows the window). Every report records which backend actually ran (`backend` in `performance.json`).

## What is covered

Every test uses the production Vite bundle served by the same origin as JSON and SSE. No static SVG harness is involved.

- `test_city_visual.py` — all city routes and every referenced asset resolve; HUD pick, pan, zoom, keyboard, inspect card, MASS bar and searchable census; actors keep identity, position and timeline across viewport travel while ambient traffic moves; follow tracks a named actor and stops on drag; two browser contexts receive version-2 rules and metric changes through signed, queued webhooks (catalog building, three bays, decor props, malformed-file fallback with warning), reconnect after going offline, and keep addresses across a server restart; a newly enrolled lot passes through grading → framing → cladding → finishing → complete over the real 45 s; a rename keeps the address and an admin removal keeps every neighbour in place; reduced motion holds crews and traffic; phone emulation (tap, bottom-sheet card, D-pad, native pinch, native search field); wilderness travel and return.
- `test_support.py` — Canvas renderer fallback draws the same city; browsers without canvas get the explicit unsupported screen; WebGL context loss and restore keeps camera, zoom and selection; resize and orientation changes relayout the HUD inside the viewport.
- `test_exports.py` — the capture button downloads a composited PNG of the Phaser canvas; `/api/city/export.svg` matches the shared plan and renders in the browser; the offline package built by `npm run export:offline` opens the saved city with network access blocked.
- `test_performance.py` — the fully featured 1,000-lot city (`large_server`) measured per scenario: idle, pan, zoom out and back, follow, live construction, live metric update. The profile (`hardware` or `software`) is chosen from the browser's actual GL driver; see `docs/PERFORMANCE.md` for the budgets. The second test asserts a software driver can never be reported under the hardware label.

Screenshots and the complete `performance.json` (driver, backend, hardware hints, budgets, measurements) are written to `e2e/screenshots/` on every run, including failures. Mobile tests emulate a touch viewport and do not substitute for physical devices; a software-profile pass proves correctness, not performance. CI (`.github/workflows/verify.yml`) uses the hosted workspace when its secrets exist and otherwise labels the run as a local SwiftShader correctness pass.
