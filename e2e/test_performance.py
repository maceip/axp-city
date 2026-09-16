"""Measured performance of the fully featured game (handoff item 4).

Every scenario below runs with all features on: persistent actors, ambient
traffic, staged construction, full detail at every zoom. Frame intervals are
sampled per scenario from the scene's own clock (`window.__AXP.diagnostics()
.frameMs`) after `resetFrameStats()`, so panning, zooming, following, a
construction site and a live update are each measured on their own.

Two profiles are enforced, chosen from the *actual* GL driver the browser
reports, never from an environment label:

* ``hardware`` — a real GPU (anything that is not SwiftShader/llvmpipe): the
  product budget, 1,000 lots: median <= 33 ms (30 FPS), p95 <= 80 ms, first
  frame within 8 s.
* ``software`` — SwiftShader/llvmpipe/Canvas: a correctness run. It proves the
  same interactions work and bounds pathological stalls (median <= 750 ms,
  p95 <= 1,500 ms) but is *not* performance proof and is labelled as such.

The full report — driver, hardware hints, backend, scene, feature settings,
per-scenario measurements and the budget applied — is always written to
``e2e/screenshots/performance.json`` (also on failure). ``CITY_PERF_PROFILE``
can force ``hardware`` to make a GPU machine fail loudly when it falls back.
"""
import json
import os
import platform
import time
from pathlib import Path

import pytest

from conftest import ready

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)

BUDGETS = {
    "hardware": dict(label="hardware GPU performance gate", median_ms=33, p95_ms=80, first_frame_ms=8000, max_visible_objects=2600),
    "software": dict(label="software-rendered correctness run (not performance proof)", median_ms=750, p95_ms=1500, first_frame_ms=45000, max_visible_objects=2600),
}


def diag(page):
    return page.evaluate("window.__AXP.diagnostics()")


MIN_SAMPLES = 12


def measure(page, name, action, settle_ms=1600):
    """Run one interaction and sample frames until the settle time has passed *and*
    enough frames exist for a median (software drivers may need longer than the
    settle time to produce them)."""
    page.evaluate("window.__AXP.resetFrameStats()")
    started = time.perf_counter()
    action()
    page.wait_for_timeout(settle_ms)
    page.wait_for_function("n => window.__AXP.diagnostics().frameMs.samples >= n", arg=MIN_SAMPLES, timeout=20000)
    state = diag(page)
    return dict(
        scenario=name,
        wall_ms=round((time.perf_counter() - started) * 1000),
        frame_ms=state["frameMs"],
        visibleLots=state["visibleLots"],
        objects=state["activeObjects"],
        allocatedObjects=state["objects"],
        drawnActors=state["drawnActors"],
        actors=state["actors"],
        chunks=state["chunks"],
        zoom=round(state["zoom"], 3),
    )


def choose_profile(driver):
    forced = os.environ.get("CITY_PERF_PROFILE")
    if forced in BUDGETS:
        return forced
    return "software" if driver["software"] else "hardware"


def test_thousand_lots_fully_featured_meets_its_profile_budget(browser, large_server, backend):
    page = browser.new_page(viewport=dict(width=1600, height=1000))
    started = time.perf_counter()
    page.goto(large_server.url + "/city", wait_until="domcontentloaded")
    page.wait_for_function("Boolean(window.__AXP) && window.__AXP.diagnostics().chunks > 0", timeout=60000)
    first_frame_ms = round((time.perf_counter() - started) * 1000)
    page.locator("#boot-card").wait_for(state="hidden")
    page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0", timeout=60000)
    page.wait_for_timeout(1000)

    driver = page.evaluate("window.__AXP.driver()")
    profile = choose_profile(driver)
    budget = BUDGETS[profile]
    initial = diag(page)
    assert initial["totalLots"] == 1000 and initial["visibleLots"] > 0 and initial["actors"] > 0

    scenarios = []
    scenarios.append(measure(page, "idle (actors animating)", lambda: None))

    def pan():
        page.mouse.move(800, 500)
        page.mouse.down()
        page.mouse.move(300, 200, steps=25)
        page.mouse.up()
        page.keyboard.down("d")
        page.wait_for_timeout(900)
        page.keyboard.up("d")

    scenarios.append(measure(page, "pan (drag + key travel)", pan))

    def zoom():
        for _ in range(4):
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(120)
        for _ in range(6):
            page.mouse.wheel(0, -240)
            page.wait_for_timeout(120)

    scenarios.append(measure(page, "zoom out to flyover and back in", zoom))

    def follow():
        page.evaluate("window.__AXP.select('bench/repo999')")
        page.wait_for_function("window.__AXP.diagnostics().selected === 'bench/repo999'")
        page.keyboard.press("f")

    scenarios.append(measure(page, "follow a named crew actor", follow, settle_ms=2200))
    following = diag(page)["following"]
    page.keyboard.press("f")

    def construction():
        large_server.metrics.append(dict(large_server.metrics[0], fullName="bench/newcomer", name="newcomer", stars=50, recentDefaultCommits=3))
        large_server.save()
        assert large_server.enroll("bench/newcomer") in (200, 201)
        page.wait_for_function("window.__AXP.snapshot().plan.placements.some(p => p.lot.fullName === 'bench/newcomer')", timeout=30000)
        page.evaluate("window.__AXP.select('bench/newcomer')")
        page.wait_for_function("window.__AXP.diagnostics().selected === 'bench/newcomer'")

    scenarios.append(measure(page, "new lot under construction (live add)", construction))
    assert page.evaluate("window.__AXP.construction('bench/newcomer')")["stage"] != "complete"

    def live_update():
        large_server.metrics[5] = dict(large_server.metrics[5], stars=99000, openPrs=12)
        large_server.save()
        assert large_server.webhook("bench/repo5", "perf-update") == 202
        page.wait_for_function("window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName === 'bench/repo5').lot.stars === 99000", timeout=30000)

    scenarios.append(measure(page, "live metric update on a visible lot", live_update))
    page.screenshot(path=str(SHOTS / "thousand-lots.png"))

    report = dict(
        profile=profile,
        budget=budget,
        driver=driver,
        backend=backend.describe(),
        hardware=dict(
            harnessHost=platform.platform(),
            harnessCpu=platform.processor() or platform.machine(),
            browserPlatform=page.evaluate("navigator.platform"),
            hardwareConcurrency=page.evaluate("navigator.hardwareConcurrency"),
            deviceMemoryGb=page.evaluate("navigator.deviceMemory ?? null"),
            devicePixelRatio=page.evaluate("devicePixelRatio"),
            viewport=page.viewport_size,
            userAgent=page.evaluate("navigator.userAgent"),
        ),
        scene=dict(totalLots=initial["totalLots"], initialVisibleLots=initial["visibleLots"], renderer=initial["rendererName"], phaser=initial["version"]),
        features=dict(persistentActors=True, ambientTraffic=True, stagedConstruction=True, fullDetailAllZooms=True, reducedMotion=initial["reducedMotion"], followed=following),
        first_frame_ms=first_frame_ms,
        scenarios=scenarios,
        measuredAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        note="A software profile pass demonstrates correctness only; hardware numbers on named devices are recorded in docs/PERFORMANCE.md.",
    )
    (SHOTS / "performance.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    page.close()

    failures = []
    if first_frame_ms > budget["first_frame_ms"]:
        failures.append(f"first frame {first_frame_ms} ms > {budget['first_frame_ms']} ms")
    for s in scenarios:
        if s["frame_ms"]["samples"] < MIN_SAMPLES:
            failures.append(f"{s['scenario']}: only {s['frame_ms']['samples']} frames sampled")
        if s["frame_ms"]["median"] > budget["median_ms"]:
            failures.append(f"{s['scenario']}: median {s['frame_ms']['median']:.1f} ms > {budget['median_ms']} ms")
        if s["frame_ms"]["p95"] > budget["p95_ms"]:
            failures.append(f"{s['scenario']}: p95 {s['frame_ms']['p95']:.1f} ms > {budget['p95_ms']} ms")
        if s["objects"] > budget["max_visible_objects"]:
            failures.append(f"{s['scenario']}: {s['objects']} active scene objects > {budget['max_visible_objects']} (viewport culling/pooling regressed)")
    assert not failures, f"{budget['label']} ({driver['renderer']}): " + "; ".join(failures)


def test_hardware_profile_is_not_claimed_on_software_drivers(page):
    """A report may only carry the hardware label when the driver is a GPU."""
    driver = page.evaluate("window.__AXP.driver()")
    if driver["software"]:
        assert choose_profile(driver) == "software" or os.environ.get("CITY_PERF_PROFILE") == "hardware"
    else:
        assert choose_profile(driver) == "hardware" or os.environ.get("CITY_PERF_PROFILE") == "software"
    if os.environ.get("CITY_PERF_PROFILE") == "hardware" and driver["software"]:
        pytest.fail(f"CITY_PERF_PROFILE=hardware but the browser is rendering with {driver['renderer']}")
