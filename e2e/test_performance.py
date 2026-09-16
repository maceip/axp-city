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

from conftest import ready, repo_metrics

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


TRAVEL_LEGS = [("d", 2500), ("s", 2500), ("a", 2500), ("w", 2500)] * 2  # a lap around the 1,000-lot city, twice
POOL_CAPACITY = 1500 + 400 + 800  # images + graphics + actor sprites (game/src/CityScene.ts, actors.ts)
TERRAIN_CACHE = 96  # game/src/terrain.ts


def test_sustained_travel_bounds_memory_textures_and_loading(browser, large_server, backend):
    """Handoff item 3: memory and loading behaviour during sustained travel.

    Two laps around the 1,000-lot city with every feature on. Allocated scene objects
    must stay inside the pools, terrain textures inside the LRU cache, every sprite sheet
    is fetched at most once, and (where the browser exposes it) the JS heap after the
    second lap must not keep climbing relative to the first."""
    page = browser.new_page(viewport=dict(width=1600, height=1000))
    ready(page, large_server.url)
    page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0", timeout=60000)
    page.evaluate("window.__AXP.select('bench/repo500')")
    page.wait_for_function("window.__AXP.diagnostics().selected === 'bench/repo500'")
    page.keyboard.press("Escape")
    samples = [dict(leg="start", **diag(page))]
    for index, (key, hold_ms) in enumerate(TRAVEL_LEGS):
        page.keyboard.down(key)
        page.wait_for_timeout(hold_ms)
        page.keyboard.up(key)
        page.wait_for_timeout(250)
        samples.append(dict(leg=f"{index + 1}:{key}", **diag(page)))
    page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0", timeout=30000)
    page.wait_for_timeout(500)
    samples.append(dict(leg="end", **diag(page)))
    page.screenshot(path=str(SHOTS / "sustained-travel-end.png"))

    keep = ["leg", "objects", "activeObjects", "pooledImages", "actors", "drawnActors", "visibleLots", "chunks", "cachedChunks", "generatedChunks", "textures", "sheetsRequested", "assetBytesRequested", "assetsInflight", "assetsFailed", "heapBytes", "scrollX", "scrollY"]
    rows = [{k: s.get(k) for k in keep} for s in samples]
    report = dict(backend=backend.describe(), driver=page.evaluate("window.__AXP.driver()"), legs=TRAVEL_LEGS, samples=rows,
                  bounds=dict(poolCapacity=POOL_CAPACITY, terrainCache=TERRAIN_CACHE), measuredAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    (SHOTS / "sustained-travel.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    page.close()

    moved = max(abs(r["scrollX"] - rows[0]["scrollX"]) for r in rows)
    assert moved > 300, "travel did not move the camera"  # key travel is dt-scaled; SwiftShader covers less ground per leg
    assert any(r["visibleLots"] == 0 for r in rows) or any(r["visibleLots"] != rows[0]["visibleLots"] for r in rows), "the view never changed"
    for r in rows:
        assert r["objects"] <= POOL_CAPACITY + 64, (r["leg"], r["objects"])  # + civics/highlight/atmosphere
        assert r["cachedChunks"] <= TERRAIN_CACHE + 8, (r["leg"], r["cachedChunks"])  # + chunks still on screen
        assert r["assetsFailed"] == [], r["assetsFailed"]
    # Loading: a finite kit, each sheet at most once, and it stops growing once seen.
    sheets = [r["sheetsRequested"] for r in rows]
    assert sheets == sorted(sheets) and sheets[-1] <= 40, sheets
    assert sheets[-1] == sheets[len(sheets) // 2] or sheets[-1] - sheets[len(sheets) // 2] <= 2, sheets
    # Textures: terrain cache + sheets + generated atlases; must not scale with distance travelled.
    assert rows[-1]["textures"] <= rows[0]["textures"] + TERRAIN_CACHE + 40, (rows[0]["textures"], rows[-1]["textures"])
    # Memory (Chromium exposes performance.memory): second lap must not keep climbing.
    heaps = [r["heapBytes"] for r in rows if r["heapBytes"] is not None]
    if heaps:
        half = len(heaps) // 2
        assert heaps[-1] <= 1.35 * max(heaps[1:half + 1]) + 16 * 2**20, [round(h / 2**20, 1) for h in heaps]


SOAK_SECONDS = int(os.environ.get("CITY_SOAK_SECONDS", "60"))
SOAK_CYCLE_S = 5.0
SOAK_TRAVEL = ["d", "s", "a", "w"]


def test_soak_session_with_live_updates_keeps_scene_state_bounded(browser, server, backend):
    """Handoff items 3/5/6 and audit finding E: sustained use of one scene.

    One page lives through ``CITY_SOAK_SECONDS`` (60 s in CI; run locally with
    300+ for the figures in docs/PERFORMANCE.md) of the whole product at once:
    a metrics update arrives through a webhook every cycle, a new repository is
    enrolled every fourth cycle (so several construction sites overlap), and the
    camera travels, zooms, selects lots and opens the census the entire time.
    The stream must stay connected, every update must land in the client,
    nothing may throw, and objects, actors, terrain textures, sheets and (in
    Chromium) the heap must plateau instead of tracking elapsed time."""
    page = browser.new_page(viewport=dict(width=1400, height=900))
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    ready(page, server.url)
    page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0", timeout=60000)
    page.wait_for_timeout(1500)
    start = diag(page)
    samples = [dict(t=0.0, cycle=0, **start)]
    updates = enrolled = 0
    began = time.time()
    cycle = 0
    while time.time() - began < SOAK_SECONDS:
        cycle += 1
        repo = server.metrics[cycle % 8]
        repo["stars"] = repo.get("stars", 0) + 137
        repo["openPrs"] = (repo.get("openPrs", 0) + 1) % 30
        server.save()
        assert server.webhook(repo["fullName"], f"soak-{cycle}") == 202
        updates += 1
        if cycle % 4 == 1:
            name = f"soak/lot{enrolled}"
            server.metrics.append(repo_metrics(name, stars=3000 + enrolled * 900, openPrs=2, recentDefaultCommits=1, recentAuthors=["ada"]))
            server.save()
            assert server.enroll(name) in (200, 201)
            enrolled += 1
        key = SOAK_TRAVEL[cycle % 4]
        page.keyboard.down(key)
        page.wait_for_timeout(1200)
        page.keyboard.up(key)
        page.keyboard.press("+" if cycle % 2 else "-")
        page.evaluate("i => { const p = window.__AXP.snapshot().plan.placements; window.__AXP.select(p[i % p.length].lot.fullName) }", cycle)
        if cycle % 3 == 0:
            page.keyboard.press("c")
            page.wait_for_timeout(400)
            page.keyboard.press("Escape")
        page.keyboard.press("Escape")
        page.wait_for_function("n => window.__AXP.diagnostics().totalLots === n", arg=8 + enrolled, timeout=20000)
        page.wait_for_function("s => window.__AXP.snapshot().plan.placements.some(p => p.lot.stars === s)", arg=repo["stars"], timeout=20000)
        remaining = SOAK_CYCLE_S - ((time.time() - began) % SOAK_CYCLE_S)
        page.wait_for_timeout(int(max(0.2, remaining) * 1000))
        samples.append(dict(t=round(time.time() - began, 1), cycle=cycle, **diag(page)))
    page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0", timeout=30000)
    page.screenshot(path=str(SHOTS / "soak-end.png"))
    sites = []
    for i in range(enrolled):  # frame each enrolled lot and read what is actually drawn for it
        page.evaluate("r => window.__AXP.select(r)", f"soak/lot{i}")
        page.wait_for_function("r => window.__AXP.drawn(r) !== null", arg=f"soak/lot{i}", timeout=20000)
        sites.append(dict(repo=f"soak/lot{i}", **page.evaluate("r => window.__AXP.drawn(r)", f"soak/lot{i}")))

    keep = ["t", "cycle", "revision", "totalLots", "objects", "activeObjects", "actors", "drawnActors", "cachedChunks", "textures", "sheetsRequested", "assetsInflight", "assetsFailed", "heapBytes", "connection", "zoom"]
    rows = [{k: s.get(k) for k in keep} for s in samples]
    report = dict(backend=backend.describe(), driver=page.evaluate("window.__AXP.driver()"), seconds=SOAK_SECONDS, cycles=cycle, updates=updates, enrolled=enrolled,
                  pageErrors=errors, sites=sites, samples=rows, measuredAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    (SHOTS / "soak.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    page.close()

    assert cycle >= 4, "soak too short to observe anything"
    assert errors == [], errors
    assert all(r["connection"] == "connected" for r in rows), [r["connection"] for r in rows]
    assert rows[-1]["revision"] >= rows[0]["revision"] + updates + enrolled, (rows[0]["revision"], rows[-1]["revision"], updates, enrolled)
    assert rows[-1]["totalLots"] == 8 + enrolled
    assert len(sites) == enrolled and all(site["stage"] and site["objects"] > 0 for site in sites), sites
    for r in rows:
        assert r["objects"] <= POOL_CAPACITY + 64, (r["cycle"], r["objects"])
        assert r["cachedChunks"] <= TERRAIN_CACHE + 8, (r["cycle"], r["cachedChunks"])
        assert r["assetsFailed"] == [], r["assetsFailed"]
    half = len(rows) // 2
    warm = rows[1:half + 1]
    # Plateaus: the second half may not out-grow the first beyond what the new lots explain.
    assert rows[-1]["actors"] <= 1.5 * max(r["actors"] for r in warm) + 12 * enrolled, ([r["actors"] for r in rows], enrolled)
    assert rows[-1]["textures"] <= max(r["textures"] for r in warm) + TERRAIN_CACHE + 20, [r["textures"] for r in rows]
    sheets = [r["sheetsRequested"] for r in rows]
    assert sheets == sorted(sheets) and sheets[-1] <= 40, sheets
    heaps = [r["heapBytes"] for r in rows if r["heapBytes"] is not None]
    if heaps:
        assert heaps[-1] <= 1.35 * max(heaps[1:half + 1]) + 16 * 2**20, [round(h / 2**20, 1) for h in heaps]


def test_hardware_profile_is_not_claimed_on_software_drivers(page):
    """A report may only carry the hardware label when the driver is a GPU."""
    driver = page.evaluate("window.__AXP.driver()")
    if driver["software"]:
        assert choose_profile(driver) == "software" or os.environ.get("CITY_PERF_PROFILE") == "hardware"
    else:
        assert choose_profile(driver) == "hardware" or os.environ.get("CITY_PERF_PROFILE") == "software"
    if os.environ.get("CITY_PERF_PROFILE") == "hardware" and driver["software"]:
        pytest.fail(f"CITY_PERF_PROFILE=hardware but the browser is rendering with {driver['renderer']}")
