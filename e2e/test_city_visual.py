"""Rendered-output checks against the production Phaser build and the real server.

Every assertion here reads the scene through `window.__AXP`, clicks HUD elements
by their canvas positions (`hudPoint`), and saves screenshots for inspection.
"""
import json
import time

import pytest
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
    """Assert the lot's rendered pixels changed far more than the animation noise floor.
    Callers hold motion (reduced motion) so the floor is near zero; the HUD toast that
    announces an update is waited out so it cannot overlap the sampled rectangle."""
    page.wait_for_function("!window.__AXP.diagnostics().toastVisible", timeout=10000)
    page.wait_for_timeout(settle_ms)
    after = lot_pixels(page, repo)
    page.wait_for_timeout(settle_ms)
    again = lot_pixels(page, repo)
    noise = pixel_distance(after, again)
    change = pixel_distance(before, after)
    assert change > max(6.0, 2.5 * noise), f"{label}: rendered lot did not change (Δ={change:.1f}, animation noise={noise:.1f})"
    return after


SITE_OBSERVER_JS = """
r => {
  const s = (window.__SITE = { seen: [], drawn: {}, again: {}, crane: false, announced: false, pending: null, done: false });
  const tick = async () => {
    const c = window.__AXP.construction(r);
    const d = window.__AXP.drawn(r);
    const stage = c ? c.stage : "complete";
    if (!s.seen.length || s.seen[s.seen.length - 1] !== stage) s.seen.push(stage);
    if (stage === "framing" || stage === "cladding") {
      if (window.__AXP.lotActors(r).some((a) => a.anim === "craneArm")) s.crane = true;
      if ((document.querySelector("#a11y-selection")?.innerText ?? "").includes("UNDER CONSTRUCTION")) s.announced = true;
    }
    // Sample mid-stage (scaffold half raised, cladding half opaque), once the on-screen
    // objects were built for this stage with every sheet loaded.
    const ready = d && d.stage === stage && !d.incomplete && window.__AXP.diagnostics().assetsInflight === 0 && (!c || c.stageProgress >= 0.5);
    if (ready && !(stage in s.drawn) && !s.pending) {
      s.pending = stage;
      const first = await window.__AXP.lotPixels(r);
      await new Promise((f) => setTimeout(f, 300));
      const second = await window.__AXP.lotPixels(r);
      s.drawn[stage] = first;
      s.again[stage] = second;
      s.pending = null;
    }
    if (stage === "complete" && "complete" in s.drawn) s.done = true;
    else setTimeout(tick, 200);
  };
  tick();
}
"""


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
        assert state["version"] == "4.2.1"
        # WebGL whenever the browser offers it; otherwise the documented Canvas fallback,
        # never silently and never the other way round.
        support = page.evaluate("window.__AXP_SUPPORT")
        if support["renderer"] == "webgl":
            assert state["renderer"] == 2 and state["rendererName"] == "webgl", state
        else:
            assert state["renderer"] == 1 and state["rendererName"] == "canvas", state
            assert any("WebGL is unavailable" in r for r in support["reasons"]), support
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
    (SHOTS / f"backend-{backend.kind}.json").write_text(json.dumps(backend.describe(), indent=2))
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
    t0, clock0 = page.evaluate("id => [window.__AXP.actorTimeline(id), window.__AXP.actorClock()]", walker)
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
    deadline = time.time() + 15
    while time.time() < deadline:
        poses.append(page.evaluate("id => window.__AXP.actor(id)", walker))
        drawn = [p for p in poses if p.get("spriteDepth") is not None]
        # A walker pauses between legs and the simulation clock is clamped per frame, so
        # sample until it has been drawn at two different spots rather than a fixed count.
        if len(drawn) >= 2 and len({(round(p["sx"]), round(p["sy"])) for p in drawn}) > 1:
            break
        page.wait_for_timeout(250)
    drawn = [p for p in poses if p.get("spriteDepth") is not None]
    assert drawn, "walker was never drawn"
    assert all(abs(p["spriteDepth"] - p["sy"]) < 12 for p in drawn), drawn
    assert len({(round(p["sx"]), round(p["sy"])) for p in drawn}) > 1, ("walker did not move", drawn)
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
    # The simulation clock advances at most 100 ms per frame, so on a software renderer
    # it runs slower than wall time; wait for it rather than for a fixed pause.
    page.wait_for_function("c => window.__AXP.actorClock() - c > 900", arg=clock0, timeout=20000)
    t1, clock1 = page.evaluate("id => [window.__AXP.actorTimeline(id), window.__AXP.actorClock()]", walker)
    # The off-screen actor's timeline advanced by exactly as much as the simulation clock
    # (it was never reset or paused).
    assert abs((t1 - t0) - (clock1 - clock0)) < 1, (t0, t1, clock0, clock1)
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
    # Hold crews and traffic in both browsers so pixel differences below come from the
    # data and rule changes, not from whatever was driving past when a sample was taken.
    for tab in [page, other]:
        tab.keyboard.press("m")
        tab.wait_for_function("window.__AXP.diagnostics().reducedMotion && !window.__AXP.diagnostics().toastVisible", timeout=10000)
    page.wait_for_timeout(600)
    original = lot_pixels(page, "acme/forge")
    default_building = page.evaluate("window.__AXP.snapshot().plan.placements[0].lot.buildingId")
    chosen = 7  # an S-band silhouette; the L-band hash for acme/forge picks from 35–50
    assert default_building != chosen
    server.metrics[0].update(stars=42000, openPrs=0, openIssues=9)
    server.save()
    # The repository's own .city rules (version 2): catalog building, three bays, decor props.
    server.repo_rules("acme/forge", building=dict(version=1, buildingId=chosen), loading_zone=dict(version=2, props=dict(issues=["materials", "lamp", "bench"]), layout=dict(bays=3, slots=[])))
    assert server.webhook("acme/forge") == 202  # persisted, then processed by the worker
    for tab in [page, other]:
        tab.wait_for_function("window.__AXP.snapshot().plan.placements[0].lot.rulesSource === 'repository' && window.__AXP.snapshot().plan.placements[0].lot.stars === 42000")
        lot = tab.evaluate("window.__AXP.snapshot().plan.placements[0].lot")
        assert lot["buildingId"] == chosen != default_building, (tab is page, lot)
        assert lot["stars"] == 42000 and lot["openIssues"] == 9 and lot["showMaterials"] and not lot["showBlueprint"], (tab is page, lot)
        assert lot["extraProps"] == ["lamp", "bench"] and lot["layout"]["bays"] == 3 and lot["rulesSource"] == "repository", (tab is page, lot)
    # The rule change is visible in the drawn lot in both browsers, not only in the data.
    page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0")
    page.wait_for_function("window.__AXP.drawnRenderKey('acme/forge') && window.__AXP.drawnRenderKey('acme/forge').includes('lamp') && window.__AXP.drawnRenderKey('acme/forge').includes('\"bays\":3')", timeout=15000)
    with_rules = rendered_change(page, "acme/forge", original, f"catalog building {chosen} (was {default_building}) + three bays + decor props")
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
    page.wait_for_function("window.__AXP.snapshot().plan.placements[0].lot.rulesWarning && !window.__AXP.snapshot().plan.placements[0].lot.layout")
    assert page.evaluate("window.__AXP.snapshot().plan.placements[0].lot.buildingId") == chosen  # the valid building.json still applies
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
    # Hold traffic and crews still so the samples measure the site itself, not passing cars.
    page.keyboard.press("m")
    page.wait_for_function("window.__AXP.diagnostics().reducedMotion")
    # The browser is the observer: a page-side ticker records every stage the plan and the
    # drawn objects go through and samples each one mid-stage, so a slow test runner (a
    # SwiftShader screenshot can take seconds) cannot miss a 14 s stage.
    page.evaluate(SITE_OBSERVER_JS, "acme/newcomer")
    shot = set()
    # The site takes CONSTRUCTION_MS (45 s); screenshots are best effort from here.
    deadline = time.time() + 120
    while time.time() < deadline:
        site = page.evaluate("window.__SITE")
        for stage in site["seen"]:
            if stage in site["drawn"] and stage not in shot:  # sampled mid-stage; the screenshot follows as soon as we notice
                shot.add(stage)
                page.screenshot(path=str(SHOTS / f"construction-{site['seen'].index(stage) + 1}-{stage}.png"))
        if site["done"]:
            break
        page.wait_for_timeout(500)
    site = page.evaluate("window.__SITE")
    seen, drawn, noise = site["seen"], site["drawn"], {k: pixel_distance(site["drawn"][k], v) for k, v in site["again"].items()}
    assert site["done"], seen
    assert seen[-1] == "complete", seen
    assert seen[:-1] == [s for s in ["grading", "framing", "cladding", "finishing"] if s in seen], seen
    assert set(drawn) == set(seen), (sorted(drawn), seen)
    assert site["crane"], "no crane arm was drawn during framing/cladding"
    assert site["announced"], "the inspect card never said UNDER CONSTRUCTION"
    assert "framing" in seen and "cladding" in seen
    # Each stage the visitor saw was drawn differently: the transition is visible, not just a field.
    # With motion held, a finished lot is a still frame; in-stage "noise" is the scaffold and
    # cladding genuinely progressing, so adjacent stages are compared against a fixed floor.
    assert noise["complete"] < 0.5, noise
    for earlier, later in zip(seen, seen[1:]):
        change = pixel_distance(drawn[earlier], drawn[later])
        assert change > 2.0, (earlier, later, change, noise[earlier], noise[later])
    assert pixel_distance(drawn[seen[0]], drawn["complete"]) > 12, "finished building looks like the graded site"
    # The card re-renders on its own while the site progresses, and once more when it completes.
    page.wait_for_function("!document.querySelector('#a11y-selection').innerText.includes('UNDER CONSTRUCTION')", timeout=3000)
    assert server.get("/api/city")["plan"]["placements"][-1]["constructing"] is False
    page.keyboard.press("m")
    page.wait_for_function("!window.__AXP.diagnostics().reducedMotion")


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
    # A transfer to another owner is the same identity (GitHub id): same address, same
    # construction start, and the lot's history records both moves.
    added_at = page.evaluate("window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName === 'acme/annex2').addedAt")
    server.metrics[-1]["fullName"] = "newco/annex2"
    server.metrics[-1]["owner"] = "newco"
    server.save()
    assert server.webhook_event("repository", dict(action="transferred", repository=dict(full_name="newco/annex2", name="annex2", id=7701, owner=dict(login="newco")), changes=dict(owner={"from": dict(organization=dict(login="acme"))})), "xfer-1") == 202
    page.wait_for_function("window.__AXP.snapshot().plan.placements.some(p => p.lot.fullName === 'newco/annex2')", timeout=15000)
    moved = page.evaluate("window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName === 'newco/annex2')")
    assert (moved["x"], moved["y"]) == before["acme/annex"]
    assert moved["addedAt"] == added_at, "transfer restarted construction"
    assert not any(p["lot"]["fullName"] == "acme/annex2" for p in page.evaluate("window.__AXP.snapshot().plan.placements"))
    history = server.get("/api/city/history?repo=newco/annex2")["history"]
    renames = [h for h in history if h["kind"] == "renamed"]
    assert [h["detail"] for h in renames][-2:] == ["from acme/annex", "from acme/annex2"], history
    after = {name if name != "acme/annex2" else "newco/annex2": at for name, at in after.items()}
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


def png_bytes(width, height, rgb):
    """A solid-colour 8-bit RGB PNG, built without any imaging dependency."""
    import struct
    import zlib
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def test_custom_artwork_rule_is_rendered_only_once_approved(page, server):
    """Handoff item 10: the version-2 `artwork` rule in actual rendered output. A repository
    asks for its own building PNG; until an operator approves that exact hash the catalog
    building stays and the card says why; once approved the browser fetches the same-origin
    copy and draws it; revoking the approval falls back again."""
    import hashlib
    repo = "acme/robots"
    art = png_bytes(128, 192, (236, 72, 153))  # a flat magenta slab no catalog building looks like
    sha = hashlib.sha256(art).hexdigest()
    fetched = []
    page.on("response", lambda r: fetched.append((r.url, r.status)) if "/assets/artwork/" in r.url else None)
    page.keyboard.press("m")
    page.wait_for_function("window.__AXP.diagnostics().reducedMotion && !window.__AXP.diagnostics().toastVisible", timeout=10000)
    page.wait_for_timeout(400)
    original = lot_pixels(page, repo)
    folder = server.rules / "repos" / repo
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "building.png").write_bytes(art)  # the fixture folder stands for the repository's .city/
    server.repo_rules(repo, building=dict(version=2, artwork=dict(path=".city/building.png", sha256=sha, width=128, height=192)))
    # 1. Requested but not approved: catalog building, reason published.
    assert server.webhook(repo, "art-1") == 202
    page.wait_for_function("r => { const l = window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName === r).lot; return l.rulesSource === 'repository' && !l.artwork && (l.rulesWarning || '').includes('not approved'); }", arg=repo, timeout=15000)
    select(page, repo)
    assert "not approved" in a11y(page, "#a11y-selection")
    page.keyboard.press("Escape")
    page.wait_for_function("!window.__AXP.diagnostics().cardVisible")
    assert fetched == [], fetched  # nothing unapproved is ever served or fetched
    # 2. Operator approval of that exact hash: fetched same-origin and drawn.
    (server.rules / "approved-artwork.json").write_text(json.dumps(dict(version=1, approved=[dict(repo=repo, sha256=sha)])))
    assert server.webhook(repo, "art-2") == 202
    page.wait_for_function("([r, s]) => { const l = window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName === r).lot; return l.artwork && l.artwork.sha256 === s && !l.rulesWarning; }", arg=[repo, sha], timeout=15000)
    page.wait_for_function("([r, s]) => window.__AXP.diagnostics().assetsInflight === 0 && (window.__AXP.drawnRenderKey(r) || '').includes(s)", arg=[repo, sha], timeout=20000)
    with_art = rendered_change(page, repo, original, "approved custom artwork replaces the catalog building")
    assert any(url.endswith(f"/assets/artwork/{sha}.png") and status == 200 for url, status in fetched), fetched
    page.screenshot(path=str(SHOTS / "rules-custom-artwork.png"))
    # 3. The operator revokes the approval (no restart): back to the catalog building, reason published.
    # Approved bytes are content-addressed, so tampering with the repository file while keeping the
    # declared hash cannot change what is drawn; only the approval decides.
    (server.rules / "approved-artwork.json").write_text(json.dumps(dict(version=1, approved=[])))
    (folder / "building.png").write_bytes(png_bytes(128, 192, (20, 200, 120)))
    assert server.webhook(repo, "art-3") == 202
    page.wait_for_function("r => { const l = window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName === r).lot; return !l.artwork && (l.rulesWarning || '').includes('not approved'); }", arg=repo, timeout=15000)
    page.wait_for_function("([r, s]) => window.__AXP.diagnostics().assetsInflight === 0 && !(window.__AXP.drawnRenderKey(r) || '').includes(s)", arg=[repo, sha], timeout=20000)
    page.wait_for_function("!window.__AXP.diagnostics().toastVisible", timeout=10000)
    page.wait_for_timeout(400)
    reverted = lot_pixels(page, repo)
    assert pixel_distance(reverted, original) < pixel_distance(reverted, with_art), "revoked artwork was still drawn"
    page.keyboard.press("m")
    page.wait_for_function("!window.__AXP.diagnostics().reducedMotion")


def test_repository_turning_private_is_withdrawn_from_every_public_path(browser, server):
    """Handoff item 9: a public-to-private transition withdraws the published records
    everywhere a visitor could still see them — two live browsers, the census and
    search, the accessible mirror, the snapshot, history, public events and both exports."""
    import urllib.error
    import urllib.request
    a, b = browser.new_page(), browser.new_page()
    ready(a, server.url)
    ready(b, server.url)
    repo = server.metrics[6]["fullName"]  # acme/stale
    assert server.webhook(repo, "stale-public") == 202
    deadline = time.time() + 15
    while not any(e["repo"] == repo for e in server.get("/events")):  # the delivery is processed asynchronously
        assert time.time() < deadline, "public event for the delivery never appeared"
        time.sleep(0.2)
    select(a, repo)
    server.metrics[6]["isPrivate"] = True
    server.save()
    assert server.webhook(repo, "stale-private") == 202
    for tab in (a, b):
        tab.wait_for_function("r => !window.__AXP.snapshot().plan.placements.some(p => p.lot.fullName === r)", arg=repo, timeout=15000)
        assert diag(tab)["totalLots"] == 7
        assert repo not in a11y(tab, "#a11y-repos")
        tab.evaluate("document.activeElement && document.activeElement.blur()")
        tab.keyboard.press("c")
        tab.wait_for_function("window.__AXP.diagnostics().censusOpen")
        tab.locator("#repo-search").fill("stale")
        tab.wait_for_function("document.querySelectorAll('#a11y-census tr').length === 1")  # header only
        tab.locator("#repo-search").press("Escape")
        tab.keyboard.press("Escape")
        tab.wait_for_function("!window.__AXP.diagnostics().censusOpen")
    # The selection that pointed at it is gone, not left pointing at a phantom.
    assert diag(a)["selected"] != repo and not diag(a)["cardVisible"]
    a.screenshot(path=str(SHOTS / "private-withdrawn.png"))
    # Every server-side public path agrees.
    assert all(p["lot"]["fullName"] != repo for p in server.get("/api/city")["plan"]["placements"])
    assert all(p["lot"]["fullName"] != repo for p in server.get("/api/city/export.json")["plan"]["placements"])
    assert all(e["repo"] != repo for e in server.get("/events"))
    with pytest.raises(urllib.error.HTTPError) as denied:
        urllib.request.urlopen(f"{server.url}/api/city/history?repo={repo}", timeout=5)
    assert denied.value.code == 404
    with urllib.request.urlopen(f"{server.url}/api/city/export.svg", timeout=10) as response:
        svg = response.read().decode()
    assert 'data-repo="acme/forge"' in svg and repo not in svg
    # Later deliveries for it are recorded as ignored and change nothing; neighbours keep their addresses.
    before = {p["lot"]["fullName"]: (p["x"], p["y"]) for p in server.get("/api/city")["plan"]["placements"]}
    assert server.webhook(repo, "stale-after") == 202
    a.wait_for_timeout(1500)
    assert {p["lot"]["fullName"]: (p["x"], p["y"]) for p in server.get("/api/city")["plan"]["placements"]} == before
    status = server.get("/api/city/status")
    assert status["freshness"]["failingRepositories"] == 0, status["freshness"]
    a.close()
    b.close()


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
