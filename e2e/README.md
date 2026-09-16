# Production browser verification

```sh
npm ci
npm run build
python3 -m pip install -r e2e/requirements.txt
python3 -m playwright install chromium
python3 -m pytest e2e -v
```

On the existing Mac setup, use `/Users/mac/.venv/bin/python` in place of `python3`. Set `HEADED=1` to watch. Every test starts the actual compiled Node server with isolated data, rules, and recorded metrics. The production Vite bundle is served through the same origin as JSON and SSE. No static SVG harness is involved.

Tests cover all normal city routes, asset loading, building picks after pan/zoom, keyboard jumps, touch taps, D-pad, native multi-touch pinch, two browser contexts, rules/metric changes through signed webhooks, reconnect resynchronization, persisted addresses and data after process restart, the actual 45-second construction interval, wilderness travel, and 1,000-lot rendering.

Screenshots and a measured `performance.json` are written to `e2e/screenshots/`. Performance assertions bound active viewport objects and frame intervals on the test machine; mobile tests emulate a touch viewport and do not substitute for physical-device profiling.
