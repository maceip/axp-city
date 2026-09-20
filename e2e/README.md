# Browser checks

The required checks use the standard `pytest-playwright` plugin, following [Streamlit's three-browser suite](https://github.com/streamlit/streamlit/blob/a807ca5f8274de0eb708729cb40266f6321b82cc/.github/workflows/playwright.yml#L27-L29). Streamlit runs Chromium, Firefox and WebKit through the plugin's `--browser` options and excludes performance tests from its normal gate. That active revision was committed on September 19, 2026; its [browser run passed](https://github.com/streamlit/streamlit/actions/runs/35410902069).

We use the same browser selection and failure-artifact pattern, with one browser per GitHub matrix job. Our server fixture starts the built application; Playwright manages browsers and contexts. The workflow has one test command for all three engines and no hosted-browser credential path. Chromium functional checks use an explicit SwiftShader renderer so local and GPU-less CI runs exercise the same WebGL path. Old runs are cancelled when a newer commit arrives.

## Run the checks

```sh
npm ci
npm run build
python3 -m pip install -r e2e/requirements.txt
python3 -m playwright install --with-deps chromium firefox webkit
npm run test:e2e
npm run test:operations
```

The Python/browser versions are pinned in `requirements.txt`, including the same Playwright 1.61.0 used for local acceptance. To run one browser:

```sh
python3 -m pytest e2e/test_core_city.py --browser chromium --screenshot only-on-failure
```

Replace `chromium` with `firefox` or `webkit`. `--headed` opens a browser window. The plugin's [`new_context` fixture](https://playwright.dev/python/docs/test-runners#using-multiple-contexts) gives each test isolated storage and handles cleanup and failure artifacts. Failure screenshots go to `test-results/`; CI uploads them and server logs on failure. Trace recording stays off in the normal gate because it records throughout every passing test too; add `--tracing retain-on-failure` when diagnosing a failure. Application captures and server logs go to `e2e/screenshots/`.

The existing functional checks cover rendering, placement/rejection, inspect/clear/undo, save/load, invalid saves, camera/input, Canvas fallback and graphics recovery under the production CSP. The trusted multi-touch test uses Chromium CDP and explicitly skips on the other engines. No functional check was removed to make the timing failure disappear. Backend backup/restore checks run once in the unit job rather than in each browser job.

## Performance is a separate measurement

The populated 96-building/20-vehicle benchmark is **not a pull-request or deployment gate**. A shared CI machine's software-rendered frame rate is not a hardware performance measurement. It runs only when requested explicitly:

```sh
npm run test:performance
# On macOS with a visible desktop, require a verified Metal driver:
CITY_CORE_HARDWARE=1 npm run test:performance
```

The benchmark still records its actual driver, viewport, frame intervals and resource counts and retains its existing thresholds. It does not loosen thresholds or turn a timeout into a pass. Run it without competing workloads when evaluating rendering performance. Historical measurements remain in [engine evidence](../docs/CORE-ENGINE.md).

Superseded GitHub-city UI suites stay deselected by default. `--legacy-ui` collects them as historical references; they do not target the current workshop. Physical phones and Apple's Safari are outside the Playwright checks.
