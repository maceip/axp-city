# Browser checks

Browser checks are manual. Run `npm run test:e2e` before milestones or relevant renderer, input or save changes; it is not an every-edit requirement. Automatic Verify Phaser city CI runs `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:operations`. It has no browser job, so a green automatic run does not prove that the game renders or its browser interactions work.

The manual suite uses the standard `pytest-playwright` plugin, following the browser selection pattern in [Streamlit's three-browser suite](https://github.com/streamlit/streamlit/blob/a807ca5f8274de0eb708729cb40266f6321b82cc/.github/workflows/playwright.yml#L27-L29). Chromium, Firefox and WebKit are selected through the plugin's `--browser` options. Our server fixture starts the built application; Playwright manages browsers, contexts and failure artifacts. There is no hosted-browser credential path. Chromium functional checks use an explicit SwiftShader renderer, including on machines without a GPU.

## Run browser acceptance manually

```sh
npm ci
npm run build
python3 -m pip install -r e2e/requirements.txt
python3 -m playwright install --with-deps chromium firefox webkit
npm run test:e2e
```

The Python/browser versions are pinned in `requirements.txt`, including the same Playwright 1.61.0 used for local acceptance. To run one browser:

```sh
python3 -m pytest e2e/test_core_city.py --browser chromium --screenshot only-on-failure
```

Replace `chromium` with `firefox` or `webkit`. `--headed` opens a browser window. The plugin's [`new_context` fixture](https://playwright.dev/python/docs/test-runners#using-multiple-contexts) gives each test isolated storage and handles cleanup and failure artifacts. Failure screenshots are saved locally in `test-results/`. Trace recording stays off by default because it records throughout every passing test too; add `--tracing retain-on-failure` when diagnosing a failure. Application captures and server logs go to `e2e/screenshots/`.

The retained functional checks cover rendering, placement/rejection, inspect/clear/undo, save/load, invalid saves, camera/input, Canvas fallback and graphics recovery under the production CSP. Inspect the near/mid/far captures during manual acceptance; pixel sanity assertions alone are not visual approval. The trusted multi-touch test uses Chromium CDP and explicitly skips on the other engines. Backend backup/restore checks remain automatic through `npm run test:operations` in the unit job.

## Performance is a separate measurement

The populated 96-building/20-vehicle benchmark is **not a pull-request or deployment gate**. A shared CI machine's software-rendered frame rate is not a hardware performance measurement. It runs only when requested explicitly:

```sh
npm run test:performance
# On macOS with a visible desktop, require a verified Metal driver:
CITY_CORE_HARDWARE=1 npm run test:performance
```

The benchmark still records its actual driver, viewport, frame intervals and resource counts and retains its existing thresholds. It does not loosen thresholds or turn a timeout into a pass. Run it without competing workloads when evaluating rendering performance. Historical measurements remain in [engine evidence](../docs/CORE-ENGINE.md).

Superseded GitHub-city UI suites stay deselected by default. `--legacy-ui` collects them as historical references; they do not target the current workshop. Physical phones and Apple's Safari are outside the Playwright checks.
