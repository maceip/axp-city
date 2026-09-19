"""Bounded stress benchmark of the built core city under its production CSP.

Default: the ordinary local browser backend, with a 100ms p95 correctness budget.
CITY_CORE_HARDWARE=1: headed Chromium/ANGLE Metal, verified GPU, 16.7ms p95 target.
96 buildings and 20 simulated vehicles; 180 rAF intervals per scenario. Actual
keyboard, wheel-button and placement interactions run during frame sampling.
The JSON report records the actual driver; software can never claim GPU proof.
"""
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import time

import pytest
from conftest import launch_local, wait_js
from core_helpers import core_ready, diagnostics, choose, click_cell

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "e2e" / "screenshots" / "core"
SAMPLES = 180
HARDWARE = os.environ.get("CITY_CORE_HARDWARE") == "1"


@pytest.fixture
def core_benchmark_runtime(playwright_runtime):
    if HARDWARE:
        assert platform.system() == "Darwin", "The Metal hardware profile requires macOS"
        browser = playwright_runtime.chromium.launch(headless=False, args=["--use-gl=angle", "--use-angle=metal"])
        description = dict(backend="local-chromium-metal", browser=browser.version, engine="chromium", headed=True)
    else:
        runtime = launch_local(playwright_runtime)
        browser, description = runtime.browser, runtime.describe()
    yield browser, description
    browser.close()


def start_sample(page, name):
    # Direct function evaluation, without wait_for_function/eval or bypass_csp.
    page.evaluate("""({name, count}) => {
      const result = {name, samples: [], done: false};
      window.__CORE_BENCH = result;
      let previous;
      function frame(now) {
        if (previous !== undefined) result.samples.push(now - previous);
        previous = now;
        if (result.samples.length >= count) result.done = true;
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }""", dict(name=name, count=SAMPLES))


def sampled(page, count):
    wait_js(page, "count => window.__CORE_BENCH.samples.length >= count", arg=count, timeout=25000, interval=15)


def finish_sample(page):
    sampled(page, SAMPLES)
    result = page.evaluate("() => window.__CORE_BENCH")
    values = sorted(result.pop("samples"))
    result.pop("done")
    result.update(samples=len(values), median_ms=round(values[len(values) // 2], 3),
                  p95_ms=round(values[math.ceil(len(values) * .95) - 1], 3),
                  max_ms=round(max(values), 3), elapsed_ms=round(sum(values), 3))
    return result


def test_populated_core_frame_budget_and_resource_plateau(core_server, core_benchmark_runtime):
    started = time.monotonic()
    browser, backend = core_benchmark_runtime
    raw_world = subprocess.check_output(["node", "--import", "tsx", "scripts/core-benchmark-world.mjs"], cwd=ROOT, text=True)
    world = json.loads(raw_world)
    assert len(world["buildings"]) == 96 and len(world["vehicles"]) == 20
    # Install a validated save through the browser's normal persistence boundary.
    context = browser.new_context(viewport=dict(width=1600, height=1000), device_scale_factor=1,
        storage_state=dict(cookies=[], origins=[dict(origin=core_server.url,
            localStorage=[dict(name="axp-core-world-v1", value=raw_world)])]))
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    report = {}
    try:
        policy = core_ready(page, core_server.url)
        assert "'unsafe-eval'" not in policy
        initial = diagnostics(page)
        assert initial["buildings"] == 96 and initial["vehicles"] == 20
        driver = page.evaluate("""() => {
          const canvas = document.querySelector('#game canvas');
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
          return {renderer: gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'Canvas 2D',
            vendor: gl ? gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) : 'browser',
            canvas: {width: canvas.width, height: canvas.height}, devicePixelRatio,
            viewport: {width: innerWidth, height: innerHeight}};
        }""")
        software = bool(re.search(r"swiftshader|llvmpipe|softpipe|software|canvas", driver["renderer"], re.I))
        if HARDWARE:
            assert not software and "metal" in driver["renderer"].lower(), driver
        # Let texture uploads and the initial route calculations complete before sampling.
        wait_js(page, "() => window.__CORE.diagnostics().tick >= 5")
        scenarios = []
        start_sample(page, "idle")
        scenarios.append(finish_sample(page))

        start_sample(page, "pan")
        page.keyboard.down("d")
        sampled(page, SAMPLES // 2)
        page.keyboard.up("d")
        page.keyboard.down("a")
        scenarios.append(finish_sample(page))
        page.keyboard.up("a")
        page.locator("[data-action='home']").click()

        start_sample(page, "zoom")
        for index in range(12):
            action = "zoom-out" if index < 6 else "zoom-in"
            page.locator(f"[data-action='{action}']").click()
            sampled(page, (index + 1) * 15)
        scenarios.append(finish_sample(page))
        page.locator("[data-action='home']").click()

        choose(page, "road")
        revision = diagnostics(page)["revision"]
        start_sample(page, "edit")
        for index, x in enumerate([-9, -8, -7, -6, -5, -4, 1, 2, 3, 4, 6, 7]):
            click_cell(page, x, 0)
            assert page.evaluate("x => window.__CORE.inspectCell(x, 0).road", x)
            sampled(page, (index + 1) * 15)
        scenarios.append(finish_sample(page))
        assert diagnostics(page)["revision"] == revision + 12

        choose(page, "inspect")
        baseline = diagnostics(page)
        travel = []
        for _ in range(2):
            for dx, dy in [(600, 0), (0, 260), (-600, 0), (0, -260)]:
                page.mouse.move(850, 450)
                page.mouse.down()
                page.mouse.move(850 + dx, 450 + dy, steps=8)
                page.mouse.up()
                travel.append(diagnostics(page))
        page.locator("[data-action='home']").click()
        final = diagnostics(page)
        assert all(s["objects"] == baseline["objects"] and s["textures"] == baseline["textures"] for s in travel), travel
        assert final["objects"] == baseline["objects"] and final["textures"] == baseline["textures"]
        assert final["tick"] > initial["tick"] and not errors, errors
        REPORTS.mkdir(parents=True, exist_ok=True)
        suffix = "hardware" if HARDWARE else backend["engine"]
        page.screenshot(path=str(REPORTS / f"performance-{suffix}.png"))
        report = dict(profile="hardware target" if HARDWARE else "browser correctness budget", backend=backend,
            driver=driver, software=software, host=dict(system=platform.system(), machine=platform.machine()),
            scene=dict(width=world["width"], height=world["height"], buildings=96, vehicles=20),
            samples_per_scenario=SAMPLES, scenarios=scenarios,
            plateau=dict(objects=baseline["objects"], textures=baseline["textures"], chunks=baseline["chunks"], travel_samples=len(travel)),
            elapsed_seconds=round(time.monotonic()-started, 2), p95_budget_ms=16.7 if HARDWARE else 100,
            measured_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        destination = REPORTS / f"performance-{suffix}.json"
        destination.write_text(json.dumps(report, indent=2) + "\n")
        failures = [f"{s['name']} p95 {s['p95_ms']}ms" for s in scenarios if s["p95_ms"] > report["p95_budget_ms"]]
        assert not failures, f"{report['profile']} ({driver['renderer']}): " + "; ".join(failures) + f"; report: {destination}"
    finally:
        context.close()
