# E2E visual harness (Playwright + pytest)

Loads a rendered fixture city in real Chromium and checks what unit tests
cannot see: sprite URLs resolve and paint, labels never collide, buildings
sit on their own pads, animation is scoped to active lots, and
click/drag/keyboard interaction works.

## Setup (once)

Uses `uv` and the home venv — no project-local env:

```sh
uv pip install --python ~/.venv/bin/python -r e2e/requirements.txt
~/.venv/bin/python -m playwright install chromium
```

## Run

```sh
~/.venv/bin/python -m pytest e2e -v        # headless
HEADED=1 ~/.venv/bin/python -m pytest e2e -v  # watch it run
```

## What it does

- Renders 8 fixture lots (every yard kind, human + bot activity) into an
  isolated temp dir via `npm run render` — the repo tree is untouched.
- Serves that dir at `/` and `assets/city-sprites/` at `/assets/sprites/`
  on `127.0.0.1` (ephemeral port), matching the live URL layout.
- 12 tests: clean load (no failed/4xx requests), sprite resolve + paint,
  label/label separation, own-label clearance, building seating, roamer
  leash, yard image budgets, animation scoping, click-to-card, drag pan,
  keyboard pan, review screenshot (`e2e/screenshots/`, git-ignored).

## Geometry notes

Overlap checks use screen-space rects: label `getBoundingClientRect`
plus clip-path rects projected through the SVG's `getScreenCTM`.
Only static stamps (`clip-lot-*`) take part in overlap checks —
animated figures (`anim-*`) legitimately roam and the labels layer paints
above them; roamers get a leash test (stay near their own tile) instead.
Cross-row art passing behind a front label is legal iso layering (opaque
label pills stay legible); pairwise label collision is not, and fails.
