"""Building selection stays a visible, non-mutating layer over the town."""
import re

import pytest
from playwright.sync_api import expect

from conftest import wait_js
from core_helpers import choose, click_cell, core_ready, diagnostics, pause, photograph, snapshot


CATALOG = {"cottage": ("Cottage", 2, 2), "shop": ("Shop", 3, 2), "workshop": ("Workshop", 3, 3)}


def open_town(new_context, core_server, viewport=(1600, 1000), **options):
    context = new_context(viewport=dict(width=viewport[0], height=viewport[1]), **options)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    core_ready(page, core_server.url)
    pause(page)
    choose(page, "inspect")
    return page, errors


def roof_point(page, building):
    point = page.evaluate("id => window.__CORE.buildingScreen(id)", building["id"])
    assert point and page.evaluate("p => document.elementFromPoint(p.x, p.y)?.tagName", point) == "CANVAS", point
    return point


def visible_building(page, exclude=None):
    # Prefer the middle row, visible on both desktop and narrow viewports. This
    # only observes screen positions; the selection itself uses a real pointer.
    buildings = sorted(snapshot(page)["buildings"], key=lambda b: (abs(b["y"] + 2), abs(b["x"])))
    for building in buildings:
        if building["id"] == exclude:
            continue
        point = page.evaluate("id => window.__CORE.buildingScreen(id)", building["id"])
        if point and page.evaluate("p => document.elementFromPoint(p.x, p.y)?.tagName", point) == "CANVAS":
            return building
    raise AssertionError("No building roof is exposed in the canvas")


def assert_selected(page, building):
    wait_js(page, "id => window.__CORE.diagnostics().selectedBuildingId === id", arg=building["id"])
    inspector = page.locator("#building-inspector")
    expect(inspector).to_be_visible()
    expect(inspector).to_have_attribute("data-building-id", building["id"])
    name, width, depth = CATALOG[building["kind"]]
    expect(page.locator("#building-title")).to_have_text(name)
    expect(page.locator("#building-footprint")).to_have_text(re.compile(rf"{width}\s*×\s*{depth} tiles"))
    expect(page.locator("#building-access")).to_have_text("Connected")
    selection = page.evaluate("() => window.__CORE.selection()")
    assert selection["buildingId"] == building["id"] and selection["commandCount"] > 0


def select(page, building):
    point = roof_point(page, building)
    page.mouse.click(point["x"], point["y"])
    assert_selected(page, building)


def assert_dismissed(page):
    wait_js(page, "() => window.__CORE.diagnostics().selectedBuildingId === null")
    expect(page.locator("#building-inspector")).to_be_hidden()
    assert page.evaluate("() => window.__CORE.selection()") == dict(buildingId=None, commandCount=0)


@pytest.mark.parametrize("viewport", [(1600, 1000), (480, 800)], ids=["desktop", "narrow"])
def test_building_card_selection_camera_and_dismissal(new_context, browser_name, core_server, viewport):
    page, errors = open_town(new_context, core_server, viewport)
    page.locator("[data-action='save']").click()
    world = snapshot(page)
    stored = page.evaluate("() => localStorage.getItem('axp-core-world-v1')")
    save_status = page.locator("#save-state").inner_text()
    first = visible_building(page)
    select(page, first)
    second = visible_building(page, exclude=first["id"])
    select(page, second)
    photograph(page, f"selection-{'desktop' if viewport[0] > 760 else 'narrow'}-{browser_name}")

    # Starting a drag on a selected roof must retain selection on release.
    point = roof_point(page, second)
    before = diagnostics(page)
    page.mouse.move(point["x"], point["y"])
    page.mouse.down()
    page.mouse.move(point["x"] + 55, point["y"] + 35, steps=8)
    page.mouse.up()
    assert_selected(page, second)
    assert abs(diagnostics(page)["scrollX"] - before["scrollX"]) > 20
    page.locator("[data-action='zoom-in']").click()
    assert_selected(page, second)
    zoom = diagnostics(page)["zoom"]
    page.locator("[data-action='focus-selection']").click()
    assert_selected(page, second)
    assert diagnostics(page)["zoom"] == zoom, "Center building must preserve the current zoom"
    centered = roof_point(page, second)
    canvas = page.locator("canvas").bounding_box()
    assert abs(centered["x"] - (canvas["x"] + canvas["width"] / 2)) < 2
    assert canvas["y"] + canvas["height"] * .3 < centered["y"] < canvas["y"] + canvas["height"] * .5

    page.locator("[data-action='close-selection']").click()
    assert_dismissed(page)
    assert page.evaluate("() => document.activeElement === document.querySelector('#game canvas')"), "Closing the inspector must not strand focus on a hidden control"
    select(page, second)
    page.keyboard.press("Escape")
    assert_dismissed(page)
    select(page, second)
    choose(page, "road")
    assert_dismissed(page)
    choose(page, "inspect")
    page.locator("[data-action='home']").click()
    select(page, first)
    click_cell(page, 0, 0)
    assert_dismissed(page)
    assert snapshot(page) == world, "Inspecting, changing selection and moving the camera cannot edit the town"
    assert page.evaluate("() => localStorage.getItem('axp-core-world-v1')") == stored
    expect(page.locator("#save-state")).to_have_text(save_status)
    assert not errors, errors


def test_selection_lifecycle_on_failed_load_load_reset_and_undo(new_context, core_server):
    page, errors = open_town(new_context, core_server)
    page.locator("[data-action='save']").click()
    stored = page.evaluate("() => localStorage.getItem('axp-core-world-v1')")
    original = snapshot(page)
    target = visible_building(page)
    select(page, target)
    # Corrupt storage is an external fault, not a hidden application mutation.
    page.evaluate("() => localStorage.setItem('axp-core-world-v1', 'invalid save')")
    page.locator("[data-action='load']").click()
    assert_selected(page, target)
    assert snapshot(page) == original
    expect(page.locator("[data-testid='status']")).to_have_attribute("data-tone", "error")
    page.evaluate("text => localStorage.setItem('axp-core-world-v1', text)", stored)
    page.locator("[data-action='load']").click()
    assert_dismissed(page)
    assert snapshot(page) == original

    choose(page, "road")
    click_cell(page, -11, 0)
    assert snapshot(page)["revision"] > original["revision"]
    choose(page, "inspect")
    select(page, target)
    page.locator("[data-action='undo']").click()
    assert_dismissed(page)
    assert snapshot(page) == original
    select(page, target)
    page.locator("[popovertarget='town-menu']").click()
    page.locator("[data-action='reset']").click()
    assert_dismissed(page)
    assert not errors, errors


def test_native_touch_selection_retains_id_through_drag_cancel_and_pinch(new_context, browser_name, core_server):
    if browser_name != "chromium":
        pytest.skip("Trusted multi-touch dispatch uses Chromium CDP; other engines cover narrow pointer selection")
    page, errors = open_town(new_context, core_server, (480, 800), is_mobile=True, has_touch=True, device_scale_factor=2)
    world = snapshot(page)
    target = visible_building(page)
    point = roof_point(page, target)
    page.touchscreen.tap(point["x"], point["y"])
    assert_selected(page, target)
    cdp = page.context.new_cdp_session(page)

    def touch(kind, points):
        cdp.send("Input.dispatchTouchEvent", dict(type=kind, touchPoints=[dict(id=i, x=x, y=y, radiusX=3, radiusY=3, force=1) for i, x, y in points]))

    other = visible_building(page, exclude=target["id"])
    cancelled = roof_point(page, other)
    touch("touchStart", [(0, cancelled["x"], cancelled["y"])])
    touch("touchCancel", [])
    assert_selected(page, target)
    before = diagnostics(page)
    touch("touchStart", [(0, point["x"], point["y"])])
    for distance in [10, 25, 40, 55]:
        touch("touchMove", [(0, point["x"] + distance, point["y"])])
    touch("touchEnd", [])
    assert_selected(page, target)
    assert abs(diagnostics(page)["scrollX"] - before["scrollX"]) > 20
    zoom = diagnostics(page)["zoom"]
    touch("touchStart", [(0, 200, 300), (1, 280, 300)])
    for distance in [50, 65, 80]:
        touch("touchMove", [(0, 240-distance, 300), (1, 240+distance, 300)])
    touch("touchEnd", [])
    wait_js(page, "z => window.__CORE.diagnostics().zoom > z + .15", arg=zoom)
    assert_selected(page, target)
    assert snapshot(page) == world
    page.locator("[data-action='focus-selection']").tap()
    assert_selected(page, target)
    photograph(page, "selection-touch-chromium")
    assert not errors, errors
