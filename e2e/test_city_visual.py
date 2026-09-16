"""End-to-end visual contract for the AXP City map.

Loads a rendered fixture city in real Chromium and checks the things unit
tests cannot see: every sprite URL resolves and paints, the map loads
without persistent labels, hovering a lot pops its tag, the camera keeps
infinite ground tiles, each yard kind stamps the right number of sprites,
animation elements only exist on active lots, and click/keyboard
interaction works.
"""

from pathlib import Path

SCREENSHOTS = Path(__file__).parent / "screenshots"

MIN_IMAGES = {
    "prs_active": 4,
    "issues_active": 3,
    "idle_active": 2,
    "prs_quiet": 2,
    "issues_quiet": 3,
}
ACTIVE_YARDS = ("prs_active", "issues_active", "idle_active")


def _screen_rects(page):
    """Every lot with its stamped clip boxes, in screen px."""
    ctm = page.evaluate(
        "() => { const m = document.querySelector('#axp-map').getScreenCTM();"
        " return [m.a, m.b, m.c, m.d, m.e, m.f]; }")
    a, b, c, d, e, f = ctm

    def project(x, y, w, h):
        pts = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
        xs = [a * px + c * py + e for px, py in pts]
        ys = [b * px + d * py + f for px, py in pts]
        return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))

    raw = page.evaluate(
        "() => [...document.querySelectorAll('g.lot')].map(g => ({"
        " repo: g.dataset.repo, yard: g.dataset.yard,"
        " images: g.querySelectorAll('image').length,"
        " animates: g.querySelectorAll('animate,animateTransform').length,"
        " stamps: [...g.querySelectorAll('image')].map(im => {"
        " const m = /url\\(#([^)]+)\\)/.exec(im.getAttribute('clip-path'));"
        " const r = document.getElementById(m[1]).querySelector('rect');"
        " return { href: im.getAttribute('href'), animated: m[1].indexOf('anim-') === 0,"
        " rect: [r.getAttribute('x'), r.getAttribute('y'),"
        " r.getAttribute('width'), r.getAttribute('height')] }; }),"
        "}))")
    lots = []
    for lot in raw:
        static = [s for s in lot["stamps"] if not s["animated"]]
        roamers = [s for s in lot["stamps"] if s["animated"]]
        building = next(s for s in lot["stamps"] if "buildings-" in s["href"])
        lots.append({
            "repo": lot["repo"],
            "yard": lot["yard"],
            "images": lot["images"],
            "animates": lot["animates"],
            "clips": [project(*map(float, s["rect"])) for s in static],
            "roamers": [project(*map(float, s["rect"])) for s in roamers],
            "building": project(*map(float, building["rect"])),
        })
    return lots


def _tile_box(pg, repo):
    box = pg.locator(f".lot-hit[data-repo=\"{repo}\"]").bounding_box()
    assert box, f"{repo}: click tile missing"
    return (box["x"], box["y"], box["width"], box["height"])


def test_map_loads_without_broken_requests(page):
    pg, failures, _ = page
    assert pg.locator("#axp-map").is_visible()
    assert failures == [], f"broken requests: {failures}"


def test_sprite_images_resolve_and_paint(page):
    pg, _, server = page
    hrefs = pg.eval_on_selector_all(
        "svg image", "els => els.map(e => e.getAttribute('href'))")
    assert len(hrefs) >= 30, f"expected a full city, saw {len(hrefs)} images"
    for href in hrefs:
        assert href.startswith("/assets/sprites/"), href
        resp = pg.request.get(f"{server}{href}")
        assert resp.status == 200, href
        assert resp.headers["content-type"] == "image/png", href
    sizes = pg.eval_on_selector_all(
        "svg image",
        "els => els.map(e => { const r = e.getBoundingClientRect();"
        " return [r.width, r.height]; })")
    assert all(w > 0 and h > 0 for w, h in sizes), "unpainted image found"


def test_map_loads_without_persistent_labels(page):
    pg, _, _ = page
    assert len(_screen_rects(pg)) == 8, "fixture should render 8 lots"
    assert pg.eval_on_selector_all(
        ".lot-label", "els => els.length") == 0, "map loaded with labels"
    tag = pg.locator("#hover-tag")
    assert tag.evaluate("el => el.hidden"), "hover tag visible on load"


def test_hover_pops_lot_tag(page):
    pg, _, _ = page
    tag = pg.locator("#hover-tag")
    pg.locator(".lot-hit").first.hover()
    tag.wait_for(state="visible")
    assert "acme/" in (tag.inner_text() or "").lower(), "hover tag names no repo"
    assert "tag-pop" in (tag.inner_html() or ""), "hover tag did not pop"
    pg.mouse.move(30, 900)
    tag.wait_for(state="hidden")


def test_animated_crew_roams_own_yard(page):
    pg, _, _ = page
    lots = _screen_rects(pg)
    assert any(lot["roamers"] for lot in lots), "no animated figures found"
    for lot in lots:
        tile = _tile_box(pg, lot["repo"])
        pad = 60.0
        for roamer in lot["roamers"]:
            cx, cy = roamer[0] + roamer[2] / 2, roamer[1] + roamer[3] / 2
            assert tile[0] - pad <= cx <= tile[0] + tile[2] + pad, (
                f"{lot['repo']}: roamer escaped its yard horizontally")
            assert tile[1] - pad <= cy <= tile[1] + tile[3] + pad, (
                f"{lot['repo']}: roamer escaped its yard vertically")


# A building must never drift off its own pad: the plant point
# (bottom-center of the building clip) has to land on the lot's own
# click tile.
def test_buildings_seated_on_own_pad(page):
    pg, _, _ = page
    for lot in _screen_rects(pg):
        tile = _tile_box(pg, lot["repo"])
        pad = 40.0
        bx, by, bw, bh = lot["building"]
        px, py = bx + bw / 2, by + bh
        assert tile[0] - pad <= px <= tile[0] + tile[2] + pad, (
            f"{lot['repo']}: building plant drifted off its pad")
        assert tile[1] - pad <= py <= tile[1] + tile[3] + pad, (
            f"{lot['repo']}: building floats above/below its pad")


def test_yard_image_budgets(page):
    pg, _, _ = page
    for lot in _screen_rects(pg):
        if lot["yard"] == "fully_dormant":
            assert lot["images"] == 1, f"{lot['repo']}: dormant lot must be bare"
        else:
            minimum = MIN_IMAGES[lot["yard"]]
            assert lot["images"] >= minimum, (
                f"{lot['repo']}: {lot['yard']} has {lot['images']} sprites,"
                f" need >={minimum}")


def test_animation_scoping(page):
    pg, _, _ = page
    for lot in _screen_rects(pg):
        if lot["yard"] in ACTIVE_YARDS:
            assert lot["animates"] > 0, f"{lot['repo']}: active lot is static"
        elif lot["yard"] == "fully_dormant":
            assert lot["animates"] == 0, f"{lot['repo']}: dormant lot animates"


def test_click_tile_opens_card(page):
    pg, _, _ = page
    pg.locator(".lot-hit").first.click()
    card = pg.locator("#lot-card")
    assert card.evaluate("el => !el.hidden"), "lot card stayed hidden"
    assert "acme/" in (card.inner_text() or ""), "card names no repo"


def test_building_size_follows_band(page):
    pg, _, _ = page
    widths = {lot["repo"]: lot["building"][2] for lot in _screen_rects(pg)}
    assert widths["acme/forge"] < widths["acme/robots"], (
        "S shed must stamp narrower than an M tower")


def test_drag_pans_map(page):
    pg, _, _ = page
    tile_before = _tile_box(pg, "acme/forge")
    pg.mouse.move(800, 500)
    pg.mouse.down()
    pg.mouse.move(950, 500, steps=10)
    pg.mouse.up()
    # Anchored landscape: content tracks the cursor 1:1, no swim.
    tile_after = _tile_box(pg, "acme/forge")
    moved = tile_after[0] - tile_before[0]
    assert abs(moved - 150) < 5, f"landscape slipped: tile moved {moved:.1f}px"


def test_keyboard_pan_moves_map(page):
    pg, _, _ = page
    before = pg.get_attribute("#axp-map", "viewBox").split()
    pg.keyboard.press("ArrowRight")
    after = pg.get_attribute("#axp-map", "viewBox").split()
    assert float(after[0]) > float(before[0]), "ArrowRight did not pan"


def test_camera_keeps_tiles_when_panning_into_wilderness(page):
    pg, _, _ = page
    world = [float(v) for v in pg.get_attribute("#axp-map", "data-world").split()]
    assert len(world) == 4, "svg must carry its tiled world bounds"
    assert pg.get_attribute("#axp-map", "data-infinite") == "1"
    for key in ["ArrowLeft", "ArrowUp"] * 30:
        pg.keyboard.press(key)
    x, y, w, h = (float(v) for v in pg.get_attribute("#axp-map", "viewBox").split())
    assert x >= world[0] - 0.5, f"camera panned past tiles: {x} < {world[0]}"
    assert y >= world[1] - 0.5, f"camera panned past tiles: {y} < {world[1]}"
    fill = pg.eval_on_selector(".infinite-fill", "el => el.getAttribute('fill')")
    assert fill and "iso-grass" in fill, "infinite grass fill missing"


def test_street_pacers_walk_roads(page):
    pg, _, _ = page
    n = pg.eval_on_selector_all(".road-life image", "els => els.length")
    # Fixture renders lots around Central Park: at least one pacer per street.
    assert n >= 1, f"expected street pacers, saw {n}"
    glides = pg.eval_on_selector_all(
        ".road-life animateTransform", "els => els.length")
    assert glides >= 2 * n, "every street pacer must glide along its road"


def test_rpg_hud_is_present(page):
    pg, _, _ = page
    assert pg.locator("#hud-district").is_visible()
    assert pg.locator("#hud-mini").is_visible()
    assert pg.locator("#pad-w").is_visible()
    assert pg.locator("#axp-map").get_attribute("data-infinite") == "1"
    assert pg.locator(".city-park").count() >= 1
    assert pg.locator(".city-freeway").count() >= 1
    assert pg.locator(".city-tram").count() >= 1
    assert pg.locator("#air-layer").count() == 1


def test_screenshot_captures_city(page):
    pg, _, _ = page
    SCREENSHOTS.mkdir(exist_ok=True)
    shot = SCREENSHOTS / "city.png"
    pg.screenshot(path=str(shot))
    assert shot.stat().st_size > 50_000, "screenshot looks empty"
