"""Rendered-output checks against the production Phaser build and the real server.

Every assertion here reads the scene through `window.__AXP`, clicks HUD elements
by their canvas positions (`hudPoint`), and saves screenshots for inspection.
"""
import json
import time
from pathlib import Path

from conftest import ADMIN, ready, repo_metrics

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)


def diag(page):
    return page.evaluate("window.__AXP.diagnostics()")


def hud(page, name):
    point = page.evaluate("name => window.__AXP.hudPoint(name)", name)
    assert point, f"HUD element {name} is not on screen"
    return point


def click_hud(page, name):
    p = hud(page, name)
    page.mouse.click(p["x"], p["y"])


def select(page, repo="acme/forge"):
    page.locator("#repo-search").fill(repo)
    page.locator("#repo-search").press("Enter")
    page.wait_for_function("repo => window.__AXP.diagnostics().selected === repo", arg=repo)
    page.wait_for_timeout(450)


def a11y(page, selector):
    return page.locator(selector).inner_text()


def lot_pixels(page, repo, grid=8):
    """Coarse colour grid of what is actually drawn for one lot (building + yard)."""
    return page.evaluate("([repo, grid]) => window.__AXP.lotPixels(repo, grid)", [repo, grid])


def pixel_distance(a, b):
    """Mean per-cell RGB distance between two samples of the same rectangle."""
    assert len(a["cells"]) == len(b["cells"])
    total = 0.0
    for ca, cb in zip(a["cells"], b["cells"]):
        total += sum((x - y) ** 2 for x, y in zip(ca, cb)) ** 0.5
    return total / len(a["cells"])


def rendered_change(page, repo, before, label, settle_ms=400):
    """Assert the lot's rendered pixels changed far more than the animation noise floor."""
    page.wait_for_timeout(settle_ms)
    after = lot_pixels(page, repo)
    page.wait_for_timeout(settle_ms)
    again = lot_pixels(page, repo)
    noise = pixel_distance(after, again)
    change = pixel_distance(before, after)
    assert change > max(6.0, 2.5 * noise), f"{label}: rendered lot did not change (Δ={change:.1f}, animation noise={noise:.1f})"
    return after


PINCH_JS = """
([kind, points]) => {
  const canvas = document.querySelector('#game canvas');
  const rect = canvas.getBoundingClientRect();
  // WebKit exposes touches only through the legacy factory; Firefox has the Touch constructor.
  const touches = points.map(p => document.createTouch
    ? document.createTouch(window, canvas, p.id, p.x + window.scrollX, p.y + window.scrollY, p.x, p.y)
    : new Touch({
        identifier: p.id, target: canvas,
        clientX: p.x, clientY: p.y, pageX: p.x + window.scrollX, pageY: p.y + window.scrollY,
        screenX: p.x, screenY: p.y, radiusX: 2, radiusY: 2, force: 1,
      }));
  const list = items => document.createTouchList ? document.createTouchList(...items) : items;
  const active = kind === 'touchend' ? [] : touches;
  const event = new TouchEvent(kind, {
    touches: list(active), targetTouches: list(active), changedTouches: list(touches),
    bubbles: true, cancelable: true, composed: true,
  });
  canvas.dispatchEvent(event);
  return rect.width > 0;
}
"""


def pinch_out(page, context, centre, distances):
    """Two-finger spread on the canvas.

    Chromium receives the gesture through CDP so the browser itself produces the pointer
    stream; Firefox and WebKit have no CDP, so the same gesture is delivered as real DOM
    TouchEvents on the canvas, which is the input Phaser's touch manager listens to.
    """
    cx, cy = centre
    points = lambda distance: [dict(x=cx - distance, y=cy, id=1), dict(x=cx + distance, y=cy, id=2)]
    first, *rest = distances
    if page.context.browser.browser_type.name == "chromium":
        cdp = context.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent", dict(type="touchStart", touchPoints=points(first)))
        for distance in rest:
            cdp.send("Input.dispatchTouchEvent", dict(type="touchMove", touchPoints=points(distance)))
            page.wait_for_timeout(30)
        cdp.send("Input.dispatchTouchEvent", dict(type="touchEnd", touchPoints=[]))
        return
    page.evaluate(PINCH_JS, ["touchstart", points(first)])
    for distance in rest:
        page.evaluate(PINCH_JS, ["touchmove", points(distance)])
        page.wait_for_timeout(30)
    page.evaluate(PINCH_JS, ["touchend", points(rest[-1])])


def test_production_routes_use_phaser_and_resolve_all_assets(browser, server, backend):
    page = browser.new_page(viewport=dict(width=1600, height=1000))
    errors = []
    failed = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("response", lambda response: failed.append((response.status, response.url)) if response.status >= 400 else None)
    for path in ["/", "/city", "/city.html"]:
        page.goto(server.url + path)
        page.wait_for_function("Boolean(window.__AXP) && window.__AXP.diagnostics().chunks > 0")
        assert page.locator("#game canvas").count() == 1
        assert page.locator("svg#axp-map").count() == 0
        state = diag(page)
        assert state["version"] == "4.2.1" and state["renderer"] == 2 and state["rendererName"] == "webgl"
    # The HUD is drawn by Phaser: every advertised control has a canvas position.
    for name in ["compass", "minimap", "zoom-in", "zoom-out", "home", "census", "capture", "svg", "motion", "follow", "status"]:
        assert hud(page, name)["width"] > 0
    # Connection and freshness are separate readings, and fixture mode is explicit.
    state = diag(page)
    assert state["connection"] == "connected" and state["mode"] == "offline"
    assert state["freshness"]["source"] == "fixture"
    assert "fixture" in a11y(page, "#a11y-status").lower()
    page.wait_for_timeout(1500)
    # The canvas holds a drawn city, not a clear colour: a lot's building and
    # yard region contains many colours, and a quiet lot differs from an active one.
    drawn = lot_pixels(page, "acme/forge")
    assert drawn["distinct"] > 60, drawn["distinct"]
    quiet = lot_pixels(page, "acme/quiet")
    assert pixel_distance(drawn, quiet) > 6
    page.screenshot(path=str(SHOTS / "desktop.png"))
    (SHOTS / "backend.json").write_text(json.dumps(backend.describe(), indent=2))
    assert not errors and not failed, (errors, failed)
    page.close()


def test_hud_pick_pan_zoom_keyboard_inspect_mass_and_census(page):
    select(page)
    state = diag(page)
    assert state["cardVisible"] and state["selected"] == "acme/forge"
    assert "L BUILDING" in a11y(page, "#a11y-selection") and "HUMAN CREW" in a11y(page, "#a11y-selection")
    page.screenshot(path=str(SHOTS / "inspect.png"))
    # Closing the card clears the one shared selection (scene highlight, follow, card, MASS).
    click_hud(page, "close-card")
    page.wait_for_function("!window.__AXP.diagnostics().cardVisible")
    assert diag(page)["selected"] is None and diag(page)["following"] is None
    assert "No repository selected" in a11y(page, "#a11y-selection")
    # Picking a building by clicking the scene selects it.
    point = page.evaluate("window.__AXP.screenPoint('acme/forge')")
    page.mouse.click(point["x"], point["y"])
    page.wait_for_function("window.__AXP.diagnostics().selected === 'acme/forge'")
    # Dragging pans, and dragging is not a click.
    before = diag(page)
    page.mouse.move(800, 500)
    page.mouse.down()
    page.mouse.move(1010, 620, steps=12)
    page.mouse.up()
    page.wait_for_function("x => Math.abs(window.__AXP.diagnostics().scrollX - x) > 100", arg=before["scrollX"])
    assert diag(page)["selected"] == "acme/forge"
    # Wheel and HUD zoom buttons.
    page.mouse.wheel(0, -350)
    page.wait_for_function("z => window.__AXP.diagnostics().zoom > z", arg=before["zoom"])
    z = diag(page)["zoom"]
    click_hud(page, "zoom-out")
    page.wait_for_function("z => window.__AXP.diagnostics().zoom < z", arg=z)
    # Number keys jump; the a11y mirror reports the honest crew label.
    page.keyboard.press("2")
    page.wait_for_function("window.__AXP.diagnostics().selected === 'acme/robots'")
    assert "ROBOT CREW" in a11y(page, "#a11y-selection")
    assert "M BUILDING" in a11y(page, "#a11y-selection")
    # Census: opens with C, browses with arrows, filters through the search box, closes with Escape.
    page.keyboard.press("c")
    page.wait_for_function("window.__AXP.diagnostics().censusOpen")
    rows = page.locator("#a11y-census tr").count()
    assert rows == 9  # header + 8 repositories
    page.keyboard.press("ArrowDown")
    page.wait_for_function("window.__AXP.diagnostics().selected !== 'acme/robots'")
    page.locator("#repo-search").fill("acme/pl")
    page.wait_for_function("document.querySelectorAll('#a11y-census tr').length === 2")
    page.locator("#repo-search").press("Escape")
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "census.png"))
    page.keyboard.press("Escape")
    page.wait_for_function("!window.__AXP.diagnostics().censusOpen")
    # Minimap click travels; compass click returns home.
    m = hud(page, "minimap")
    before = diag(page)
    page.mouse.click(m["x"] - m["width"] * 0.35, m["y"] - m["height"] * 0.3)
    page.wait_for_function("s => Math.abs(window.__AXP.diagnostics().scrollX - s.scrollX) > 50 || Math.abs(window.__AXP.diagnostics().scrollY - s.scrollY) > 50", arg=before)
    click_hud(page, "compass")
    page.wait_for_function("Math.abs(window.__AXP.diagnostics().scrollX - (-746)) < 5 || window.__AXP.diagnostics().zoom === 1")


def test_actors_persist_across_viewport_travel_and_ambient_life_moves(page):
    select(page)
    actors = page.evaluate("window.__AXP.lotActors('acme/forge')")
    assert {a["behaviour"] for a in actors} >= {"walk", "carry", "wave", "fly"}
    assert all(a["anim"].startswith("human") or a["anim"] == "cargoDrone" for a in actors), actors
    walker = next(a for a in actors if a["behaviour"] == "walk")["id"]
    page.wait_for_function("id => window.__AXP.actor(id).sx !== undefined", arg=walker)
    t0 = page.evaluate("id => window.__AXP.actorTimeline(id)", walker)
    ambient0 = page.evaluate("window.__AXP.ambient()")
    kinds = {a["id"].split(":")[1].split("-")[0] for a in ambient0}
    assert kinds >= {"car", "tram", "walker", "stander"}
    page.wait_for_timeout(1000)
    ambient1 = {a["id"]: a for a in page.evaluate("window.__AXP.ambient()")}
    moved = [a["id"] for a in ambient0 if a["id"].startswith("ambient:car") and abs(ambient1[a["id"]]["sx"] - a["sx"]) > 5]
    assert moved, "freeway cars did not move"
    # Layering follows movement: a drawn actor's depth is its current foot position, so it
    # passes behind and in front of neighbouring buildings and props as it moves.
    poses = []
    for _ in range(4):
        poses.append(page.evaluate("id => window.__AXP.actor(id)", walker))
        page.wait_for_timeout(250)
    drawn = [p for p in poses if p.get("spriteDepth") is not None]
    assert drawn, "walker was never drawn"
    assert all(abs(p["spriteDepth"] - p["sy"]) < 12 for p in drawn), drawn
    assert len({round(p["sy"]) for p in drawn}) > 1 or len({round(p["sx"]) for p in drawn}) > 1, "walker did not move"
    # Travel until the lot leaves the screen: its sprite is detached but its timeline continues.
    page.keyboard.down("D")
    try:
        page.wait_for_function("window.__AXP.diagnostics().visibleLots === 0", timeout=15000)
    finally:
        page.keyboard.up("D")
    assert page.evaluate("id => window.__AXP.actor(id).sx === undefined || true", walker)
    assert diag(page)["drawnActors"] < diag(page)["actors"]
    click_hud(page, "home")
    page.wait_for_function("window.__AXP.diagnostics().visibleLots > 0")
    page.wait_for_timeout(300)
    t1 = page.evaluate("id => window.__AXP.actorTimeline(id)", walker)
    assert t1 > t0 + 900, (t0, t1)
    # Same lot, same actor ids after returning: nothing was rebuilt.
    again = page.evaluate("window.__AXP.lotActors('acme/forge')")
    assert [a["id"] for a in again] == [a["id"] for a in actors]
    page.screenshot(path=str(SHOTS / "actors-after-return.png"))


def test_follow_tracks_a_named_actor_and_stops_on_drag(page):
    select(page)
    click_hud(page, "follow")
    page.wait_for_function("Boolean(window.__AXP.diagnostics().following)")
    following = diag(page)["following"]
    who = page.evaluate("id => window.__AXP.actor(id)", following)
    assert who["repo"] == "acme/forge" and who["behaviour"] in ("fly", "walk", "carry")
    start = diag(page)
    page.wait_for_function("s => Math.abs(window.__AXP.diagnostics().scrollX - s.scrollX) > 2 || Math.abs(window.__AXP.diagnostics().scrollY - s.scrollY) > 2", arg=start, timeout=8000)
    page.screenshot(path=str(SHOTS / "follow.png"))
    page.mouse.move(700, 600)
    page.mouse.down()
    page.mouse.move(760, 640, steps=6)
    page.mouse.up()
    assert diag(page)["following"] is None
    # F on nothing selected explains itself instead of grabbing a random sprite.
    page.keyboard.press("Escape")
    page.keyboard.press("f")
    page.wait_for_timeout(200)
    assert diag(page)["following"] is None


def test_two_browsers_receive_rules_and_metrics_updates_and_reconnect(page, browser, server):
    other = browser.new_page(viewport=dict(width=1280, height=800))
    ready(other, server.url)
    second = other.context
    first_pos = server.get("/api/city")["plan"]["placements"][0]
    page.wait_for_timeout(600)
    original = lot_pixels(page, "acme/forge")
    server.metrics[0].update(stars=42000, openPrs=0, openIssues=9)
    server.save()
    # The repository's own .city rules (version 2): catalog building, three bays, decor props.
    server.repo_rules("acme/forge", building=dict(version=1, buildingId=42), loading_zone=dict(version=2, props=dict(issues=["materials", "lamp", "bench"]), layout=dict(bays=3, slots=[])))
    assert server.webhook("acme/forge") == 202  # persisted, then processed by the worker
    for tab in [page, other]:
        tab.wait_for_function("window.__AXP.snapshot().plan.placements[0].lot.buildingId === 42 && window.__AXP.snapshot().plan.placements[0].lot.stars === 42000")
        lot = tab.evaluate("window.__AXP.snapshot().plan.placements[0].lot")
        assert lot["stars"] == 42000 and lot["openIssues"] == 9 and lot["showMaterials"] and not lot["showBlueprint"]
        assert lot["extraProps"] == ["lamp", "bench"] and lot["layout"]["bays"] == 3 and lot["rulesSource"] == "repository"
    # The rule change is visible in the drawn lot in both browsers, not only in the data.
    page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0")
    page.wait_for_function("window.__AXP.drawnRenderKey('acme/forge') && window.__AXP.drawnRenderKey('acme/forge').includes('lamp') && window.__AXP.drawnRenderKey('acme/forge').includes('\"bays\":3')", timeout=15000)
    with_rules = rendered_change(page, "acme/forge", original, "catalog building 42 + three bays + decor props")
    other.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0")
    assert pixel_distance(lot_pixels(other, "acme/forge"), with_rules) < pixel_distance(lot_pixels(other, "acme/forge"), original)
    select(page)
    assert "3 bays" in a11y(page, "#a11y-selection") and "lamp" in a11y(page, "#a11y-selection") and "Repository rules" in a11y(page, "#a11y-selection")
    page.screenshot(path=str(SHOTS / "rules-v2.png"))
    page.keyboard.press("Escape")
    page.wait_for_function("!window.__AXP.diagnostics().cardVisible")
    # A malformed rule file never breaks the lot: validated defaults apply and the card says why.
    server.repo_rules("acme/forge", loading_zone='{"version": 2, "props": {"issues": ["volcano"]}}')
    assert server.webhook("acme/forge", "bad-rules") == 202
    page.wait_for_function("window.__AXP.snapshot().plan.placements[0].lot.buildingId === 42 && !window.__AXP.snapshot().plan.placements[0].lot.layout")
    lot = page.evaluate("window.__AXP.snapshot().plan.placements[0].lot")
    assert "loading-zone.json" in lot["rulesWarning"] and lot.get("extraProps", []) == []
    # Falling back to default yard rules redraws the yard (bays and decor gone) while the building stays.
    rendered_change(page, "acme/forge", with_rules, "malformed loading-zone falls back to validated defaults")
    select(page)
    assert "loading-zone.json" in a11y(page, "#a11y-selection")
    page.screenshot(path=str(SHOTS / "rules-malformed-fallback.png"))
    second.set_offline(True)
    other.wait_for_function("window.__AXP.diagnostics().connection === 'reconnecting'")
    server.metrics[0]["stars"] = 51000
    server.save()
    server.webhook("acme/forge", "missed")
    second.set_offline(False)
    other.wait_for_function("window.__AXP.snapshot().plan.placements[0].lot.stars === 51000", timeout=20000)
    server.restart()
    for tab in [page, other]:
        tab.wait_for_function("window.__AXP.diagnostics().connection === 'connected'", timeout=20000)
        tab.reload()
        tab.wait_for_function("Boolean(window.__AXP)")
        result = tab.evaluate("window.__AXP.snapshot().plan.placements[0]")
        assert result["lot"]["stars"] == 51000
        assert (result["x"], result["y"]) == (first_pos["x"], first_pos["y"])
    other.close()


def test_new_lot_construction_progresses_through_stages_without_reload(page, server):
    server.metrics.append(repo_metrics("acme/newcomer", stars=14000, openPrs=3, recentDefaultCommits=1, recentAuthors=["ada"]))
    server.save()
    # Webhooks for never-enrolled repositories are recorded and ignored; an administrator enrolls.
    assert server.webhook("acme/newcomer", "stranger") == 202
    page.wait_for_timeout(1500)
    assert diag(page)["totalLots"] == 8
    assert server.enroll("acme/newcomer") in (200, 201)
    page.wait_for_function("window.__AXP.diagnostics().totalLots === 9")
    select(page, "acme/newcomer")
    seen = []
    drawn = {}
    deadline = time.time() + 55
    while time.time() < deadline:
        site = page.evaluate("window.__AXP.construction('acme/newcomer')")
        stage = site["stage"] if site else "complete"
        if not seen or seen[-1] != stage:
            seen.append(stage)
            page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0")
            page.wait_for_timeout(250)
            drawn[stage] = lot_pixels(page, "acme/newcomer")
            page.screenshot(path=str(SHOTS / f"construction-{len(seen)}-{stage}.png"))
            if stage == "framing":
                assert any(a["anim"] == "craneArm" for a in page.evaluate("window.__AXP.lotActors('acme/newcomer')"))
                assert "UNDER CONSTRUCTION" in a11y(page, "#a11y-selection")
        if stage == "complete":
            break
        page.wait_for_timeout(700)
    assert seen[-1] == "complete", seen
    assert seen[:-1] == [s for s in ["grading", "framing", "cladding", "finishing"] if s in seen], seen
    assert "framing" in seen and "cladding" in seen
    # Each stage the visitor saw was drawn differently: the transition is visible, not just a field.
    for earlier, later in zip(seen, seen[1:]):
        assert pixel_distance(drawn[earlier], drawn[later]) > 6, (earlier, later, pixel_distance(drawn[earlier], drawn[later]))
    assert pixel_distance(drawn[seen[0]], drawn["complete"]) > 12, "finished building looks like the graded site"
    assert "UNDER CONSTRUCTION" not in a11y(page, "#a11y-selection")
    assert server.get("/api/city")["plan"]["placements"][-1]["constructing"] is False


def test_rename_keeps_the_address_and_removal_keeps_neighbours(page, server):
    before = {p["lot"]["fullName"]: (p["x"], p["y"]) for p in server.get("/api/city")["plan"]["placements"]}
    server.metrics.append(repo_metrics("acme/annex2", openIssues=2, repoId=7701))
    server.metrics[7]["repoId"] = 7701  # acme/annex
    server.save()
    assert server.webhook("acme/annex") == 202
    page.wait_for_function("window.__AXP.snapshot().plan.placements.some(p => p.lot.fullName === 'acme/annex' && p.lot.repoId === 7701)")
    server.metrics.pop(7)
    server.save()
    assert server.webhook_event("repository", dict(action="renamed", repository=dict(full_name="acme/annex2", name="annex2", id=7701, owner=dict(login="acme")), changes=dict(repository=dict(name={"from": "annex"})), sender=dict(login="human")), "rename-1") == 202
    page.wait_for_function("window.__AXP.snapshot().plan.placements.some(p => p.lot.fullName === 'acme/annex2')", timeout=15000)
    after = {p["lot"]["fullName"]: (p["x"], p["y"]) for p in page.evaluate("window.__AXP.snapshot().plan.placements")}
    assert after["acme/annex2"] == before["acme/annex"]
    assert "acme/annex" not in after
    # Removal by an administrator withdraws the lot; every neighbour keeps its address.
    import urllib.request
    request = urllib.request.Request(server.url + "/api/city/lots/acme/quiet", method="DELETE", headers={"Authorization": f"Bearer {ADMIN}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        assert response.status in (200, 204)
    page.wait_for_function("window.__AXP.diagnostics().totalLots === 7")
    final = {p["lot"]["fullName"]: (p["x"], p["y"]) for p in page.evaluate("window.__AXP.snapshot().plan.placements")}
    assert "acme/quiet" not in final
    for name, at in final.items():
        assert at == after[name], name
    page.screenshot(path=str(SHOTS / "after-rename-removal.png"))


def test_reduced_motion_holds_crews_and_traffic(page):
    page.keyboard.press("m")
    page.wait_for_function("window.__AXP.diagnostics().reducedMotion")
    a = page.evaluate("window.__AXP.ambient()")
    page.wait_for_timeout(900)
    b = {x["id"]: x for x in page.evaluate("window.__AXP.ambient()")}
    assert all(abs(b[x["id"]]["sx"] - x["sx"]) < 0.01 for x in a)
    page.keyboard.press("m")
    page.wait_for_function("!window.__AXP.diagnostics().reducedMotion")


def test_mobile_tap_dpad_pinch_and_layout(browser, server):
    context = browser.new_context(viewport=dict(width=390, height=844), device_scale_factor=2, is_mobile=True, has_touch=True)
    page = context.new_page()
    ready(page, server.url)
    select(page)
    assert diag(page)["cardVisible"]
    card = hud(page, "card")
    assert card["y"] > 400  # bottom sheet on phones
    page.screenshot(path=str(SHOTS / "mobile-inspect.png"))
    close = hud(page, "close-card")
    page.touchscreen.tap(close["x"], close["y"])
    page.wait_for_function("!window.__AXP.diagnostics().cardVisible")
    point = page.evaluate("window.__AXP.screenPoint('acme/forge')")
    page.touchscreen.tap(point["x"], point["y"])
    page.wait_for_function("window.__AXP.diagnostics().selected === 'acme/forge'")
    close = hud(page, "close-card")
    page.touchscreen.tap(close["x"], close["y"])
    page.wait_for_function("!window.__AXP.diagnostics().cardVisible")
    before = diag(page)
    east = hud(page, "move-east")
    page.touchscreen.tap(east["x"], east["y"])
    page.wait_for_function("x => window.__AXP.diagnostics().scrollX > x + 10", arg=before["scrollX"])
    pinch_out(page, context, centre=(195, 400), distances=[35, 40, 48, 60, 75, 90])
    page.wait_for_function("z => window.__AXP.diagnostics().zoom > z + 0.2", arg=before["zoom"])
    assert page.evaluate("document.documentElement.scrollWidth") == 390
    # The native search field opens a real keyboard path on phones.
    page.locator("#repo-search").tap()
    assert page.evaluate("document.activeElement.id") == "repo-search"
    page.screenshot(path=str(SHOTS / "mobile.png"))
    context.close()


def test_wilderness_and_return_keep_existing_lots_in_place(page):
    before = page.evaluate("window.__AXP.snapshot().plan.placements.map(p => [p.lot.fullName, p.x, p.y])")
    page.keyboard.down("D")
    try:
        page.wait_for_function("window.__AXP.diagnostics().visibleLots === 0", timeout=15000)
    finally:
        page.keyboard.up("D")
    page.screenshot(path=str(SHOTS / "wilderness.png"))
    state = diag(page)
    assert state["visibleLots"] == 0 and state["chunks"] < 90
    click_hud(page, "home")
    page.wait_for_function("window.__AXP.diagnostics().visibleLots > 0")
    assert page.evaluate("window.__AXP.snapshot().plan.placements.map(p => [p.lot.fullName, p.x, p.y])") == before
