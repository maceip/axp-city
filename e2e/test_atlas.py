"""Manual acceptance of the globe → repository district → local town journey.

Read-only diagnostics locate rendered targets and observe results. Navigation,
editing, selection, zoom and gestures use visible controls and real input.
"""
import json
import re
import time
from pathlib import Path

import pytest
from playwright.sync_api import expect

from conftest import wait_js
from core_helpers import choose, click_cell, core_ready, diagnostics, pause, snapshot


SHOTS = Path(__file__).parent / "screenshots" / "atlas"
CATALOG = json.loads((Path(__file__).parents[1] / "game/src/atlas/public-repositories.json").read_text())


def atlas(page):
    return page.evaluate("() => window.__ATLAS.snapshot()")


def capture(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))


def open_atlas(page):
    page.locator("#open-world").click()
    wait_js(page, "() => Boolean(window.__ATLAS) && window.__ATLAS.snapshot().active")
    expect(page.locator("#atlas-shell")).to_be_visible()
    expect(page.locator("#atlas-canvas canvas")).to_be_visible()
    assert diagnostics(page)["atlasActive"]


def language_regions(page):
    continent = next(c for c in atlas(page)["continents"] if c["name"] == "JavaScript")
    page.locator(f".atlas-language[data-place-id='{continent['id']}']").click()
    settle_regions(page, continent)
    return continent


def settle_regions(page, continent):
    wait_js(page, "c => { const a = window.__ATLAS.snapshot(); return a.level === 'regions' && a.continent === c.id && Math.abs(a.pov.lat-c.lat) < .01 && Math.abs(a.pov.lng-c.lng) < .01; }", arg=continent)
    previous, stable = atlas(page)["pov"], 0
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        page.wait_for_timeout(100)
        current = atlas(page)["pov"]
        stable = stable + 1 if all(abs(current[k] - previous[k]) < .0001 for k in ["lat", "lng", "altitude"]) else 0
        if stable >= 2:
            return
        previous = current
    raise AssertionError("The continent camera flight did not settle")


def enter_region(page, region):
    page.locator(f".atlas-tag[data-place-id='{region['id']}']").click()
    wait_js(page, "() => window.__CORE.diagnostics().repositoryDistrict && !window.__CORE.diagnostics().atlasActive")
    expect(page.locator("#atlas-shell")).to_be_hidden()
    expect(page.locator("#district-navigation")).to_be_visible()
    assert diagnostics(page)["buildings"] == region["repos"]


def wheel_until(page, direction, predicate):
    # Repeat real wheel input to cross a level threshold rather than assuming
    # a single delta has the same zoom effect across browser engines.
    for _ in range(24):
        if page.evaluate(predicate):
            return
        page.mouse.wheel(0, direction * 180)
        page.wait_for_timeout(100)
    wait_js(page, predicate, timeout=3000)


def select_exposed_roof(page):
    for building in snapshot(page)["buildings"]:
        point = page.evaluate("id => window.__CORE.buildingScreen(id)", building["id"])
        if point and page.evaluate("p => document.elementFromPoint(p.x, p.y) === document.querySelector('#game canvas')", point):
            page.mouse.click(point["x"], point["y"])
            wait_js(page, "id => window.__CORE.diagnostics().selectedBuildingId === id", arg=building["id"])
            expect(page.locator("#building-inspector")).to_be_visible()
            return building["id"]
    raise AssertionError("No repository or town roof is exposed for a real click")


@pytest.mark.parametrize("viewport", [(1600, 1000), (480, 800)], ids=["desktop", "narrow"])
def test_atlas_district_round_trip_preserves_local_edits(new_context, browser_name, core_server, viewport):
    page = new_context(viewport=dict(width=viewport[0], height=viewport[1])).new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    core_ready(page, core_server.url)
    pause(page)
    original = snapshot(page)
    page.locator("[data-action='save']").click()
    stored = page.evaluate("() => localStorage.getItem('axp-core-world-v1')")
    choose(page, "road")
    click_cell(page, 0, 7)
    assert snapshot(page)["revision"] == original["revision"] + 1
    choose(page, "inspect")
    selected = select_exposed_roof(page)
    page.locator("[data-action='zoom-in']").click()
    local, camera = snapshot(page), diagnostics(page)

    open_atlas(page)
    expect(page.locator("#building-inspector")).to_be_hidden()
    page.keyboard.press("3")
    page.keyboard.press("Space")
    page.keyboard.press("Control+s")
    assert diagnostics(page)["selectedTool"] == "inspect"
    assert snapshot(page) == local, "Atlas controls must not edit or unpause the retained town"
    assert page.evaluate("() => localStorage.getItem('axp-core-world-v1')") == stored

    continent = next(c for c in atlas(page)["continents"] if c["name"] == "JavaScript")
    marker = page.locator(f".atlas-language[data-place-id='{continent['id']}']")
    marker.hover()
    wait_js(page, "id => window.__ATLAS.snapshot().hovered === id", arg=continent["id"])
    center = page.evaluate("id => window.__ATLAS.screen(id)", continent["id"])
    polygon_hits = []
    observed = []
    # These positions lie outside the icon. They must hit the polygon itself,
    # proving that hover applies across land rather than only to its DOM marker.
    for dx, dy in [(36, 0), (-36, 0), (0, 36), (0, -36), (52, 0), (-52, 0)]:
        point = dict(x=center["x"] + dx, y=center["y"] + dy)
        observed.append(page.evaluate("p => { const e = document.elementFromPoint(p.x,p.y); return {point:p,tag:e?.tagName,id:e?.id,class:e?.className}; }", point))
        if not page.evaluate("p => document.elementFromPoint(p.x, p.y) === document.querySelector('#atlas-canvas canvas')", point):
            continue
        page.mouse.move(point["x"], point["y"])
        page.wait_for_timeout(100)
        observed[-1]["hovered"] = atlas(page)["hovered"]
        if atlas(page)["hovered"] == continent["id"]:
            polygon_hits.append(point)
        if len(polygon_hits) == 2:
            break
    assert len(polygon_hits) == 2, ("Language land must be hoverable away from the icon", observed)
    suffix = f"{viewport[0]}-{browser_name}"
    capture(page, f"world-hover-{suffix}")

    continent = language_regions(page)
    if viewport[0] < 700:
        for region in continent["regions"]:
            tag = page.locator(f".atlas-tag[data-place-id='{region['id']}']")
            expect(tag).to_be_visible()
            box = tag.bounding_box()
            assert box and 0 <= box["x"] and box["x"] + box["width"] <= viewport[0], (region["name"], box)
            assert 0 <= box["y"] and box["y"] + box["height"] <= viewport[1], (region["name"], box)
    capture(page, f"regions-{suffix}")
    region = continent["regions"][0]
    enter_region(page, region)
    select_exposed_roof(page)
    repo_name = page.locator("#building-title").inner_text()
    repo = next(r for r in CATALOG["repos"] if r["fullName"] == repo_name)
    assert repo["language"] == "JavaScript"
    expect(page.locator("#building-repo")).to_have_attribute("href", repo["url"])
    assert repo["language"] in page.locator("#building-topics").inner_text()
    district = snapshot(page)
    page.keyboard.press("3")
    page.keyboard.press("Control+s")
    page.keyboard.press("Control+z")
    assert diagnostics(page)["selectedTool"] == "inspect"
    after = snapshot(page)
    assert all(after[key] == district[key] for key in ["revision", "cells", "buildings"]), "Repository districts are read-only"
    assert page.evaluate("() => localStorage.getItem('axp-core-world-v1')") == stored
    capture(page, f"district-{suffix}")

    page.locator("#district-back").click()
    wait_js(page, "() => window.__ATLAS.snapshot().active && window.__ATLAS.snapshot().level === 'regions'")
    assert atlas(page)["continent"] == continent["id"]
    enter_region(page, region)
    page.locator("#district-town").click()
    expect(page.locator("#atlas-shell")).to_be_hidden()
    expect(page.locator("#atlas-shell")).not_to_have_class(re.compile("atlas-departing"))
    expect(page.locator("#district-navigation")).to_be_hidden()
    assert not diagnostics(page)["repositoryDistrict"]
    assert snapshot(page) == local, "Returning must restore the exact paused local town"
    restored = diagnostics(page)
    assert restored["selectedBuildingId"] == selected
    for field in ["zoom", "scrollX", "scrollY"]:
        assert abs(restored[field] - camera[field]) < .01, (field, camera, restored)
    expect(page.locator("#save-state")).to_have_text("Unsaved changes")
    page.locator("[data-action='undo']").click()
    assert snapshot(page) == original, "The local undo history must survive district exploration"
    assert page.evaluate("() => localStorage.getItem('axp-core-world-v1')") == stored
    assert not errors, errors


def test_wheel_zoom_connects_world_regions_district_and_back(new_context, core_server):
    page = new_context(viewport=dict(width=1600, height=1000)).new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    core_ready(page, core_server.url)
    open_atlas(page)
    before = diagnostics(page)
    wait_js(page, "tick => window.__CORE.diagnostics().tick > tick + 2", arg=before["tick"])
    page.mouse.move(1000, 500)
    wheel_until(page, -1, "() => window.__ATLAS.snapshot().level === 'regions'")
    wheel_until(page, 1, "() => window.__ATLAS.snapshot().level === 'world'")
    continent = language_regions(page)
    region = continent["regions"][0]
    page.locator(f".atlas-tag[data-place-id='{region['id']}']").click()
    assert atlas(page)["entering"]
    page.mouse.move(1000, 500)
    page.mouse.wheel(0, 400)
    wait_js(page, "() => !window.__ATLAS.snapshot().entering", timeout=1500)
    page.wait_for_timeout(850)  # exceed the cancelled district-entry timer
    assert atlas(page)["active"] and diagnostics(page)["atlasActive"]
    assert not diagnostics(page)["repositoryDistrict"], "Zooming back out must cancel entry rather than opening a district later"
    page.locator("#atlas-continent").click()
    settle_regions(page, continent)
    page.mouse.move(1000, 500)
    wheel_until(page, -1, "() => window.__ATLAS.snapshot().entering || window.__CORE.diagnostics().repositoryDistrict")
    wait_js(page, "() => window.__CORE.diagnostics().repositoryDistrict && !window.__CORE.diagnostics().atlasActive")
    expect(page.locator("#atlas-shell")).to_be_hidden()
    for _ in range(12):
        if diagnostics(page)["atlasActive"]:
            break
        page.locator("[data-action='zoom-out']").click()
    wait_js(page, "() => window.__ATLAS.snapshot().active && window.__ATLAS.snapshot().level === 'regions'")
    page.locator("#atlas-town").click()
    expect(page.locator("#atlas-shell")).to_be_hidden()
    assert not diagnostics(page)["repositoryDistrict"]
    assert not errors, errors


def test_native_touch_rotates_and_pinches_the_globe(new_context, browser_name, core_server):
    if browser_name != "chromium":
        pytest.skip("Trusted multi-touch uses Chromium CDP; WebKit has narrow pointer coverage")
    page = new_context(viewport=dict(width=480, height=800), is_mobile=True, has_touch=True, device_scale_factor=2).new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    core_ready(page, core_server.url)
    pause(page)
    town = snapshot(page)
    page.locator("#open-world").tap()
    wait_js(page, "() => Boolean(window.__ATLAS) && window.__ATLAS.snapshot().active")
    cdp = page.context.new_cdp_session(page)

    def touch(kind, points):
        cdp.send("Input.dispatchTouchEvent", dict(type=kind, touchPoints=[dict(id=i, x=x, y=y, radiusX=3, radiusY=3, force=1) for i, x, y in points]))

    pov = atlas(page)["pov"]
    assert page.evaluate("() => document.elementFromPoint(90, 330) === document.querySelector('#atlas-canvas canvas')")
    touch("touchStart", [(0, 90, 330)])
    for x in [110, 130, 150, 170]:
        touch("touchMove", [(0, x, 330)])
    touch("touchEnd", [])
    wait_js(page, "p => { const q = window.__ATLAS.snapshot().pov; return Math.abs(q.lng-p.lng) + Math.abs(q.lat-p.lat) > 2; }", arg=pov)
    height = next(y for y in [200, 260, 320, 420] if page.evaluate("y => [180,300].every(x => document.elementFromPoint(x,y) === document.querySelector('#atlas-canvas canvas'))", y))
    altitude = atlas(page)["pov"]["altitude"]
    touch("touchStart", [(0, 180, height), (1, 300, height)])
    for distance in [70, 80, 90, 100]:
        touch("touchMove", [(0, 240-distance, height), (1, 240+distance, height)])
    touch("touchEnd", [])
    wait_js(page, "a => window.__ATLAS.snapshot().pov.altitude < a - .2", arg=altitude)
    assert snapshot(page) == town, "Globe gestures must not edit or pan the retained town"
    capture(page, "native-touch-globe-chromium")
    page.locator("#atlas-town").tap()
    expect(page.locator("#atlas-shell")).to_be_hidden()
    assert snapshot(page) == town
    assert not errors, errors
