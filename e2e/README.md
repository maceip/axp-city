# Core workshop browser verification

Run against the built application and its production CSP:

```sh
npm ci
npm run build
python3 -m pip install -r e2e/requirements.txt
python3 -m playwright install --with-deps chromium firefox webkit
npm run test:e2e
CITY_LOCAL_BROWSER=1 CITY_BROWSER=firefox python3 -m pytest e2e/test_core_city.py -v
CITY_LOCAL_BROWSER=1 CITY_BROWSER=webkit python3 -m pytest e2e/test_core_city.py -v
```

The default suite includes core acceptance, the populated-world benchmark and preserved backend operations. It explicitly deselects 32 superseded UI tests. `--legacy-ui` opts into those historical checks; they do not pass against the new workshop and are not part of its acceptance claim.

## Coverage

- `test_core_city.py`: lightweight server without integration APIs or database, placement constraints, paused edits, browser save/load, corrupt-save preservation, roof picking, clear/undo, desktop and narrow views at three zooms, Canvas fallback, resource bounds across camera travel, and real WebGL context loss/restore with pixel comparison.
- Trusted touchscreen tap/drag/pinch uses Chromium CDP in an emulated phone. That case explicitly skips on Firefox and WebKit; it does not substitute synthetic events or imply physical-device proof.
- `test_core_performance.py`: a strictly validated 64×64 world with 96 buildings, 20 vehicles and 741 road cells. Samples 180 animation-frame intervals each during idle, pan, zoom and 12 real road edits. Checks exact object/texture bounds over eight camera-travel checkpoints.
- `test_operations.py`: preserved integration-store backup/restore, missing/corrupt-store refusal and secret exposure checks.

Screenshots and JSON measurements are written under `e2e/screenshots/core/`. Inspect representative rendered output in addition to checking assertions. See [engine evidence](../docs/CORE-ENGINE.md) for the recorded run and its limits.

## Browser backend and performance

Local Playwright is the default. `CITY_LOCAL_BROWSER=1` forces it even if hosted variables are configured. `CITY_SOFTWARE_GL=1` selects SwiftShader; `CITY_DISABLE_WEBGL=1` exercises Canvas. Software rendering has a loose 100ms p95 correctness budget and never counts as hardware performance proof.

On macOS with a visible desktop, run the dedicated Chromium Metal profile:

```sh
CITY_LOCAL_BROWSER=1 CITY_CORE_HARDWARE=1 python3 -m pytest e2e/test_core_performance.py -v
```

It verifies the actual driver before enforcing a 16.7ms p95 target. Reports include driver, browser, resolution, device pixel ratio, scene population, per-scenario median/p95/maximum intervals and resource counts. Close competing browser or build workloads before performance measurements.

Optional Azure Playwright uses `PLAYWRIGHT_SERVICE_URL` and `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` for the shared functional harness. A configured URL without its token fails closed. The stress benchmark always launches locally and reports that backend explicitly. The hosted CI job excludes it because the required local job already runs it; a hosted functional run is not hosted performance proof. CI installs browsers on the runner for its required local proof. Physical phones and Apple's Safari remain outside these Playwright checks.
