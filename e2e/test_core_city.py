"""Core city acceptance against the built Phaser client and production CSP.

Diagnostics observe outcomes; placement, rejection, save/load and camera changes
are driven through actual pointer/keyboard events and visible controls.
"""
import json
import urllib.error
import urllib.request

import pytest

from conftest import wait_js
from core_helpers import cell, choose, click_cell, core_ready, diagnostics, pause, photograph, snapshot


def test_default_core_server_has_no_ingestion_api_or_database(core_server):
    health = core_server.get("/healthz")
    assert health["experience"] == "core" and health["integrations"] is False
    assert health["persistence"] == "browser" and core_server.get("/readyz")["ready"]
    with pytest.raises(urllib.error.HTTPError) as missing:
        urllib.request.urlopen(core_server.url + "/api/city", timeout=5)
    assert missing.value.code == 404
    assert not list(core_server.root.rglob("*.sqlite*")), "Serving the local map must never initialize the integration database"


@pytest.fixture
def core_page(new_context, core_server):
    page = new_context(viewport=dict(width=1600, height=1000)).new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    core_ready(page, core_server.url)
    yield page
    assert not errors, errors


def test_placement_obeys_road_access_and_occupancy(core_page, browser_name):
    page = core_page
    pause(page)
    start = snapshot(page)
    choose(page, "road")
    # An island road cannot be made before it connects to the network.
    click_cell(page, -12, 0)
    assert not cell(snapshot(page), -12, 0)["road"]
    assert snapshot(page)["revision"] == start["revision"]
    rejection = page.locator("[data-testid='status']").inner_text()
    assert rejection.strip(), "Rejected command must explain why in visible status"
    water = next(
        (dict(x=x, y=y) for y in range(-2, 3) for x in range(-20, -15)
         if cell(start, x, y)["terrain"] == "water"), None,
    )
    assert water, "Demo must expose a river for the water-placement acceptance check"
    click_cell(page, water["x"], water["y"])
    assert cell(snapshot(page), water["x"], water["y"])["terrain"] == "water"
    assert not cell(snapshot(page), water["x"], water["y"])["road"]
    assert snapshot(page)["revision"] == start["revision"]

    click_cell(page, -11, 0)
    wait_js(page, "() => window.__CORE.inspectCell(-11, 0).road")
    click_cell(page, -12, 0)
    wait_js(page, "() => window.__CORE.inspectCell(-12, 0).road")
    choose(page, "cottage")
    before = len(snapshot(page)["buildings"])
    click_cell(page, -12, -2)
    wait_js(page, "n => window.__CORE.snapshot().buildings.length === n + 1", arg=before)
    after = snapshot(page)
    building = next(b for b in after["buildings"] if b["x"] == -12 and b["y"] == -2)
    assert building["kind"] == "cottage"
    assert cell(after, -12, -2)["occupant"] == building["id"]
    click_cell(page, -12, -2)
    assert len(snapshot(page)["buildings"]) == before + 1, "Cannot place overlapping buildings"
    choose(page, "bulldoze")
    click_cell(page, -12, 0)
    assert cell(snapshot(page), -12, 0)["road"], "Cannot remove a building's only road access"
    photograph(page, f"placement-and-rejections-{browser_name}")


def test_pause_save_load_restores_the_world(core_page):
    page = core_page
    wait_js(page, "() => window.__CORE.diagnostics().tick > 2")
    pause(page)
    frozen = snapshot(page)
    page.wait_for_timeout(350)
    assert snapshot(page) == frozen, "Pausing must stop world time and vehicle movement"
    page.locator("[data-action='save']").click()
    stored = page.evaluate("() => localStorage.getItem('axp-core-world-v1')")
    assert stored and json.loads(stored), "Save must persist a readable world"
    choose(page, "road")
    click_cell(page, -11, 0)
    assert cell(snapshot(page), -11, 0)["road"]
    page.locator("[data-action='load']").click()
    wait_js(page, "() => !window.__CORE.inspectCell(-11, 0).road")
    assert snapshot(page) == frozen, "Load must restore cells, entities, IDs, clock and revision"
    pause(page, False)
    wait_js(page, "tick => window.__CORE.diagnostics().tick > tick", arg=frozen["tick"])


def test_visible_roof_picks_the_building_and_clear_can_be_undone(core_page, browser_name):
    page = core_page
    pause(page)
    before = snapshot(page)
    target = next(b for b in before["buildings"] if b["x"] == 6 and b["y"] == 3)
    roof = page.evaluate("id => window.__CORE.buildingScreen(id)", target["id"])
    assert roof and page.evaluate("p => document.elementFromPoint(p.x, p.y)?.tagName", roof) == "CANVAS"
    choose(page, "inspect")
    page.mouse.click(roof["x"], roof["y"])
    assert "Workshop" in page.locator("[data-testid='status']").inner_text()
    choose(page, "bulldoze")
    page.mouse.click(roof["x"], roof["y"])
    cleared = snapshot(page)
    assert [b for b in cleared["buildings"] if b["id"] == target["id"]] == []
    assert len(cleared["buildings"]) == len(before["buildings"]) - 1
    assert all(c["occupant"] != target["id"] for c in cleared["cells"])
    page.locator("[data-action='undo']").click()
    assert snapshot(page) == before, "Undo must restore the exact removed building and its occupancy"
    photograph(page, f"roof-clear-undone-{browser_name}")


def test_drag_release_over_toolbar_restores_placement_preview(core_page):
    page = core_page
    pause(page)
    choose(page, "road")
    before = snapshot(page)
    page.mouse.move(900, 440)
    wait_js(page, "() => window.__CORE.placementPreview().commandCount > 0")
    page.mouse.down()
    page.mouse.move(700, 400, steps=8)
    page.mouse.move(140, 160, steps=12)
    assert page.evaluate("() => document.elementFromPoint(140, 160)?.tagName") != "CANVAS"
    page.mouse.up()
    page.mouse.move(850, 450, steps=12)
    wait_js(page, "() => window.__CORE.placementPreview().commandCount > 0", timeout=2000)
    assert snapshot(page) == before, "Releasing a drag over the toolbar must not edit the town"


@pytest.mark.parametrize("modifier", ["Control", "Meta"])
def test_save_shortcut_does_not_pan_camera(core_page, modifier):
    page = core_page
    pause(page)
    before = diagnostics(page)
    page.keyboard.down(modifier)
    page.keyboard.down("s")
    try:
        page.wait_for_timeout(250)
    finally:
        page.keyboard.up("s")
        page.keyboard.up(modifier)
    after = diagnostics(page)
    assert abs(after["scrollX"] - before["scrollX"]) < .01
    assert abs(after["scrollY"] - before["scrollY"]) < .01
    assert page.evaluate("() => Boolean(localStorage.getItem('axp-core-world-v1'))")


@pytest.mark.parametrize("viewport", [(1600, 1000), (480, 800)], ids=["desktop", "narrow"])
def test_camera_and_tiles_at_near_mid_and_far(new_context, browser_name, core_server, viewport):
    page = new_context(viewport=dict(width=viewport[0], height=viewport[1])).new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    core_ready(page, core_server.url)
    pause(page)
    choose(page, "inspect")
    engine = browser_name
    suffix = f"{viewport[0]}-{engine}"
    home = page.evaluate("() => window.__CORE.cellScreen(0, 0)")
    initial = snapshot(page)
    photograph(page, f"mid-{suffix}")
    page.locator("[data-action='zoom-in']").click()
    page.locator("[data-action='zoom-in']").click()
    near = diagnostics(page)["zoom"]
    photograph(page, f"near-{suffix}")
    for _ in range(4):
        page.locator("[data-action='zoom-out']").click()
    assert diagnostics(page)["zoom"] < near
    photograph(page, f"far-{suffix}")
    assert snapshot(page) == initial, "Zoom must never change the world"

    page.locator("[data-action='home']").click()
    center = page.evaluate("() => window.__CORE.cellScreen(0, 0)")
    page.mouse.move(center["x"], center["y"])
    page.mouse.down()
    page.mouse.move(center["x"] + 100, center["y"] + 70, steps=12)
    page.mouse.up()
    moved = page.evaluate("() => window.__CORE.cellScreen(0, 0)")
    assert abs(moved["x"] - center["x"]) > 50, (center, moved)
    assert snapshot(page) == initial, "Camera drag must not edit the map"
    page.locator("[data-action='home']").click()
    restored = page.evaluate("() => window.__CORE.cellScreen(0, 0)")
    assert abs(restored["x"] - home["x"]) < 2 and abs(restored["y"] - home["y"]) < 2
    assert not errors, errors


def test_canvas_fallback_supports_real_editing(new_context, browser_name, core_server):
    page = new_context(viewport=dict(width=1600, height=1000)).new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    core_ready(page, core_server.url, "?renderer=canvas")
    assert diagnostics(page)["renderer"] == "canvas"
    pause(page)
    choose(page, "road")
    click_cell(page, -11, 0)
    assert cell(snapshot(page), -11, 0)["road"]
    photograph(page, f"canvas-fallback-{browser_name}")
    assert not errors, errors


def test_invalid_saved_world_is_rejected_without_losing_open_town(core_page):
    page = core_page
    pause(page)
    before = snapshot(page)
    corrupt = '{"version":99,"cells":[]}'
    page.evaluate("text => localStorage.setItem('axp-core-world-v1', text)", corrupt)
    page.locator("[data-action='load']").click()
    status = page.locator("[data-testid='status']")
    assert status.get_attribute("data-tone") == "error"
    assert "invalid" in status.inner_text().lower()
    assert snapshot(page) == before
    assert page.evaluate("() => localStorage.getItem('axp-core-world-v1')") == corrupt


def test_invalid_startup_save_stays_visible_and_preserves_saved_copy(new_context, core_server):
    context = new_context(viewport=dict(width=1600, height=1000))
    context.add_init_script("localStorage.setItem('axp-core-world-v1', 'broken saved town')")
    page = context.new_page()
    core_ready(page, core_server.url)
    status = page.locator("[data-testid='status']")
    assert status.get_attribute("data-tone") == "error", "Startup warning must survive initial tool selection"
    assert "saved" in status.inner_text().lower()
    assert page.evaluate("() => localStorage.getItem('axp-core-world-v1')") == "broken saved town"
    assert diagnostics(page)["buildings"] > 0


def test_sustained_camera_travel_keeps_objects_and_textures_bounded(core_page, browser_name):
    page = core_page
    pause(page)
    choose(page, "inspect")
    before, world = diagnostics(page), snapshot(page)
    samples = []
    # Travel several viewport widths in each direction, visiting terrain well
    # outside the initial town, then revisit it. No direct camera API is used.
    for dx, dy in [(360, 0)] * 4 + [(0, 240)] * 4 + [(-360, 0)] * 4 + [(0, -240)] * 4:
        page.mouse.move(800, 480)
        page.mouse.down()
        page.mouse.move(800 + dx, 480 + dy, steps=8)
        page.mouse.up()
        page.wait_for_timeout(50)
        samples.append(diagnostics(page))
    page.locator("[data-action='home']").click()
    after = diagnostics(page)
    assert all(s["textures"] <= before["textures"] for s in samples), samples
    assert all(s["objects"] <= before["objects"] for s in samples), samples
    assert after["textures"] == before["textures"] and after["objects"] == before["objects"]
    assert snapshot(page) == world
    photograph(page, f"sustained-travel-return-{browser_name}")


def test_webgl_context_recovery_preserves_world_camera_and_pixels(core_page, browser_name):
    from PIL import Image, ImageChops, ImageStat
    from core_helpers import SHOTS
    page = core_page
    if diagnostics(page)["renderer"] != "webgl":
        pytest.skip("Canvas fallback has no WebGL context to lose")
    pause(page)
    page.locator("[data-action='zoom-out']").click()
    before, world = diagnostics(page), snapshot(page)
    SHOTS.mkdir(parents=True, exist_ok=True)
    engine = browser_name
    original = SHOTS / f"context-before-{engine}.png"
    restored = SHOTS / f"context-after-{engine}.png"
    page.locator("canvas").screenshot(path=str(original))
    supported = page.evaluate("""() => {
      const canvas = document.querySelector('#game canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      window.__CORE_LOSS_EXT = ext;
      ext.loseContext();
      return true;
    }""")
    assert supported, "WebGL renderer did not expose its context-loss test extension"
    page.wait_for_timeout(350)
    page.evaluate("() => window.__CORE_LOSS_EXT.restoreContext()")
    wait_js(page, "g => Boolean(window.__CORE) && window.__CORE.diagnostics().generation > g", arg=before["generation"])
    after = diagnostics(page)
    assert snapshot(page) == world
    assert after["paused"]
    for field in ["zoom", "scrollX", "scrollY"]:
        assert abs(after[field] - before[field]) < .01, (field, before, after)
    photograph(page, f"context-restored-{engine}")
    page.locator("canvas").screenshot(path=str(restored))
    with Image.open(original) as a, Image.open(restored) as b:
        delta = ImageStat.Stat(ImageChops.difference(a.convert("RGB"), b.convert("RGB"))).mean
        assert max(delta) < 2, f"Context restoration changed the paused map pixels: {delta}"


def test_mobile_native_touch_tap_drag_and_pinch(new_context, browser_name, core_server):
    if browser_name != "chromium":
        pytest.skip("Trusted multi-touch dispatch uses Chromium CDP; other engines run narrow viewport coverage")
    context = new_context(viewport=dict(width=480, height=800), is_mobile=True, has_touch=True, device_scale_factor=2)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    core_ready(page, core_server.url)
    page.locator("[data-action='pause']").tap()
    assert diagnostics(page)["paused"]
    page.locator("[data-tool='road']").tap()
    # South-edge extension is inside the phone viewport; the desktop
    # west-edge extension is outside this much narrower camera.
    point = page.evaluate("() => window.__CORE.cellScreen(0, 7)")
    assert page.evaluate("p => document.elementFromPoint(p.x, p.y)?.tagName", point) == "CANVAS", point
    page.touchscreen.tap(point["x"], point["y"])
    assert cell(snapshot(page), 0, 7)["road"], "A finger tap must apply the selected tool"
    world = snapshot(page)
    cdp = context.new_cdp_session(page)
    def touch(kind, points):
        cdp.send("Input.dispatchTouchEvent", dict(type=kind, touchPoints=[dict(id=i, x=x, y=y, radiusX=3, radiusY=3, force=1) for i, x, y in points]))
    cancelled = page.evaluate("() => window.__CORE.cellScreen(0, 8)")
    assert page.evaluate("p => document.elementFromPoint(p.x, p.y)?.tagName", cancelled) == "CANVAS"
    touch("touchStart", [(0, cancelled["x"], cancelled["y"])])
    touch("touchCancel", [])
    assert snapshot(page) == world, "Native gesture cancellation must never be treated as a placement tap"
    page.locator("[data-tool='inspect']").tap()
    before = diagnostics(page)
    touch("touchStart", [(0, 240, 340)])
    for x in range(250, 341, 10):
        touch("touchMove", [(0, x, 340)])
    touch("touchEnd", [])
    wait_js(page, "x => Math.abs(window.__CORE.diagnostics().scrollX - x) > 50", arg=before["scrollX"])
    zoom = diagnostics(page)["zoom"]
    touch("touchStart", [(0, 200, 340), (1, 280, 340)])
    for distance in [50, 65, 80, 95]:
        touch("touchMove", [(0, 240-distance, 340), (1, 240+distance, 340)])
    touch("touchEnd", [])
    wait_js(page, "z => window.__CORE.diagnostics().zoom > z + .15", arg=zoom)
    assert snapshot(page) == world, "Gestures must never place or remove a tile"
    assert page.evaluate("() => document.documentElement.scrollWidth") == 480
    photograph(page, "mobile-native-touch-chromium")
    assert not errors, errors
