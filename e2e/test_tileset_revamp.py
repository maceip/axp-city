"""Tileset diversity, civic objects, center office, and restyled HUD.

Each check reads the production Phaser scene through `window.__AXP` and
saves screenshots. The hosted Playwright service is preferred; see conftest.
"""
from pathlib import Path

from PIL import Image

from conftest import CityServer, ready, repo_metrics

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)


def diag(page):
    return page.evaluate("window.__AXP.diagnostics()")


def hud(page, name):
    point = page.evaluate("name => window.__AXP.hudPoint(name)", name)
    assert point, f"HUD element {name} is not on screen"
    return point


def street_lane_share(path: Path, box):
    """Last-audit classifier: khaki only after asphalt-grey, so 0x767056 used to read as ~1%."""
    image = Image.open(path).convert("RGB")
    x0, y0, x1, y1 = box
    n = khaki = cream = lime = 0
    pix = image.load()
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 2):
            r, g, b = pix[x, y]
            n += 1
            sat = max(r, g, b) - min(r, g, b)
            if g > r + 28 and g > b + 20 and sat > 55:
                lime += 1
            if 70 < r < 140 and 70 < g < 140 and 70 < b < 140 and abs(r - g) < 18:
                continue
            if 90 < r < 190 and 95 < g < 175 and 60 < b < 140 and g >= r - 16 and r - b > 18 and g - r < 8:
                khaki += 1
            elif r > 190 and g > 175 and 140 < b < 210 and abs(r - g) < 30:
                cream += 1
    return khaki / n, cream / n, lime / n


def click_hud(page, name):
    p = hud(page, name)
    page.mouse.click(p["x"], p["y"])


def overview_arrow_groups(path: Path, box) -> tuple[int, int]:
    """Cream-on-asphalt blobs in the full overview freeway strip, not a crop."""
    image = Image.open(path).convert("RGB")
    x0, y0, x1, y1 = box
    pix = image.load()
    cream = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = pix[x, y]
            if not (r > 220 and g > 200 and 150 < b < 225 and abs(r - g) < 32 and r - b > 20):
                continue
            dark = 0
            for dx, dy in ((-10, 0), (10, 0), (0, -7), (0, 7)):
                xx, yy = x + dx, y + dy
                if x0 <= xx < x1 and y0 <= yy < y1:
                    rr, gg, bb = pix[xx, yy]
                    if rr < 145 and gg < 140 and bb < 155:
                        dark += 1
            if dark >= 2:
                cream.append((x, y))
    if not cream:
        return 0, 0
    groups = {x // 160 for x, _y in cream}
    return len(cream), len(groups)


def cream_ink_width(path: Path) -> int:
    """Width of cream or brass HUD lettering. SwiftShader fillText grows this past the word."""
    image = Image.open(path).convert("RGB")
    xs = []
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = image.getpixel((x, y))
            cream = r > 200 and g > 190 and b > 150
            gold = r > 200 and g > 170 and 120 < b < 190 and r - b > 40
            if cream or gold:
                xs.append(x)
    return max(xs) - min(xs) + 1 if xs else 0


def clip_hud(page, name, dest: Path) -> Path:
    point = hud(page, name)
    page.screenshot(
        path=str(dest),
        clip={
            "x": max(0, point["x"] - point["width"] / 2),
            "y": max(0, point["y"] - point["height"] / 2),
            "width": point["width"],
            "height": point["height"],
        },
    )
    return dest


def assert_kit_label(page, name: str, expected: str) -> None:
    text = page.evaluate("name => window.__AXP.hudLabel(name)", name)
    assert text == expected, f"HUD {name} game text is {text!r}, expected {expected!r}"
    dest = clip_hud(page, name, SHOTS / f"tileset-hud-label-{name}.png")
    ink = cream_ink_width(dest)
    scale = 14 / 32
    expected_w = len(expected) * 19 * scale
    doubled_w = (len(expected) + 2) * 19 * scale
    assert ink > expected_w * 0.65, f"{name} label ink too thin ({ink}px) for {expected!r}"
    assert abs(ink - expected_w) < abs(ink - doubled_w), (
        f"{name} stamp still reads doubled: ink {ink}px expected ~{expected_w:.0f}px doubled ~{doubled_w:.0f}px"
    )


def diverse_metrics():
    rows = []
    for i in range(36):
        rows.append(
            repo_metrics(
                f"studio/lot-{i:02d}",
                stars=(i * 1373) % 40000,
                openPrs=i % 5,
                openIssues=(i * 3) % 7,
                recentDefaultCommits=1 if i % 3 else 0,
            )
        )
    return rows


def test_diverse_repo_buildings_office_civics_and_hud(backend, tmp_path, browser):
    server = CityServer(tmp_path, diverse_metrics())
    page = browser.new_page(viewport=dict(width=1600, height=1000))
    try:
        ready(page, server.url)
        info = diag(page)
        assert info["rendererName"] in ("webgl", "canvas")
        assert info["totalLots"] == 36
        assert info["office"] and info["office"]["sprite"] == "office"
        assert info["officeStampWidth"] >= 400
        assert info["civicCount"] > 8
        kinds = info["civicByKind"]
        assert kinds.get("office", 0) >= 1
        assert kinds.get("plant", 0) >= 4, f"missing park/vacant plants: {kinds}"
        assert kinds.get("odd", 0) >= 1, f"missing unused odd buildings: {kinds}"
        assert kinds.get("road", 0) >= 4, f"restyled roads not in the plan: {kinds}"
        assert kinds.get("bike", 0) >= 4, f"bike-lane stamps missing from the plan: {kinds}"
        assert kinds.get("gate", 0) >= 1
        assert info["hasBikeLane"], "bike-lane feature missing from the city plan"
        assert info["hasFreewayBikeLane"], "freeway bike shoulder missing from the city plan"
        assert info["freewayBikeBand"] >= 1.8, f"freeway bike shoulder still too thin: {info['freewayBikeBand']}"
        assert info["roadStampWidth"] >= 140, f"roads still stamp too small: {info['roadStampWidth']}"
        assert info["bikeStampWidth"] >= 180, f"bike lanes still stamp too small: {info['bikeStampWidth']}"
        assert info["uniqueFacades"] >= 12, f"repo lots still look cloned: {info['uniqueFacades']} unique facades"

        click_hud(page, "zoom-out")
        click_hud(page, "zoom-out")
        page.wait_for_timeout(400)
        page.screenshot(path=str(SHOTS / "tileset-city-overview.png"), full_page=False)
        page.screenshot(path=str(SHOTS / "tileset-roads-bikes-civics.png"), full_page=False)
        khaki, cream, lime = street_lane_share(SHOTS / "tileset-city-overview.png", (480, 180, 1400, 520))
        assert khaki >= 0.05, f"overview bike corridor still recedes as asphalt ({khaki:.3f} khaki)"
        assert khaki + cream >= 0.10, f"overview khaki+chevron share still too thin ({khaki + cream:.3f})"
        assert lime < 0.12, f"overview bike paint drifted to neon lime ({lime:.3f})"
        arrow_px, arrow_groups = overview_arrow_groups(SHOTS / "tileset-city-overview.png", (80, 160, 1520, 320))
        assert arrow_groups >= 3, (
            f"full overview PNG still hides painted arrows ({arrow_px} cream-on-asphalt px, {arrow_groups} groups)"
        )
        assert arrow_px >= 900, f"full overview arrows still too thin ({arrow_px} cream-on-asphalt px)"
        marks = page.evaluate("window.__AXP.bikeMarkScreens()")
        on_screen = [
            m
            for m in marks
            if m.get("visible", True)
            and m["width"] > 12
            and m["height"] > 8
            and 0 < m["x"] + m["width"] / 2 < 1600
            and 80 < m["y"] + m["height"] / 2 < 900
        ]
        assert len(on_screen) >= 3, f"overview bike chevrons/labels missing: {len(marks)} marks"
        chevrons = [
            m
            for m in on_screen
            if m.get("kind") == "chevron" and m.get("glance") and m["width"] > 40 and m["height"] > 16
        ]
        assert len(chevrons) >= 2, f"overview painted chevrons missing: {len(chevrons)} of {len(on_screen)}"
        flyover_plaques = [m for m in on_screen if m.get("kind") == "plaque"]
        assert flyover_plaques == [], f"flyover still plaque-first: {len(flyover_plaques)} visible plaques"
        freeway_chevrons = [m for m in chevrons if 90 < m["y"] + m["height"] / 2 < 380]
        mark = min(
            freeway_chevrons or chevrons,
            key=lambda m: abs(m["x"] + m["width"] / 2 - 1040) + abs(m["y"] + m["height"] / 2 - 230),
        )
        pad = 52
        mark_clip = {
            "x": max(0, mark["x"] - pad),
            "y": max(0, mark["y"] - pad),
            "width": min(1600, mark["x"] + mark["width"] + pad) - max(0, mark["x"] - pad),
            "height": min(1000, mark["y"] + mark["height"] + pad) - max(0, mark["y"] - pad),
        }
        page.screenshot(path=str(SHOTS / "tileset-freeway-bike.png"), clip=mark_clip)
        fw_k, fw_c, fw_lime = street_lane_share(
            SHOTS / "tileset-freeway-bike.png", (0, 0, int(mark_clip["width"]), int(mark_clip["height"]))
        )
        assert mark.get("kind") == "chevron", f"freeway clip still targeted a plaque: {mark}"
        assert fw_c >= 0.04, f"freeway clip has no cream arrow body ({fw_c:.3f})"
        assert cream_ink_width(SHOTS / "tileset-freeway-bike.png") >= 48, "freeway chevron clip missing cream arrow ink"
        assert fw_lime < 0.12, f"freeway mark clip drifted to neon lime ({fw_k:.3f}/{fw_c:.3f}/{fw_lime:.3f})"
        corridor = page.evaluate("window.__AXP.featureScreenBox('freeway-bike-lane')")
        assert corridor and corridor["width"] > 80 and corridor["height"] > 20, f"freeway bike screen box missing: {corridor}"

        click_hud(page, "home")
        page.wait_for_timeout(500)
        page.screenshot(path=str(SHOTS / "tileset-center-office.png"), full_page=False)
        page.screenshot(path=str(SHOTS / "tileset-street-home.png"), full_page=False)
        home_marks = page.evaluate("window.__AXP.bikeMarkScreens()")
        plaques = [
            m
            for m in home_marks
            if m.get("visible", True)
            and m.get("kind") == "plaque"
            and 40 < m["width"] < 280
            and 0 < m["x"] + m["width"] / 2 < 1600
            and 80 < m["y"] + m["height"] / 2 < 900
        ]
        assert len(plaques) >= 2, f"home-zoom BIKE LANE plaques disappeared: {len(plaques)}"
        plaque = plaques[len(plaques) // 2]
        plaque_pad = 64
        plaque_clip = {
            "x": max(0, plaque["x"] - plaque_pad),
            "y": max(0, plaque["y"] - plaque_pad),
            "width": min(1600, plaque["x"] + plaque["width"] + plaque_pad) - max(0, plaque["x"] - plaque_pad),
            "height": min(1000, plaque["y"] + plaque["height"] + plaque_pad) - max(0, plaque["y"] - plaque_pad),
        }
        page.screenshot(path=str(SHOTS / "tileset-freeway-bike-plaque.png"), clip=plaque_clip)
        assert cream_ink_width(SHOTS / "tileset-freeway-bike-plaque.png") >= 36, "home plaque clip missing BIKE LANE ink"
        home_k, _home_c, home_lime = street_lane_share(SHOTS / "tileset-street-home.png", (200, 180, 1400, 520))
        assert home_k >= 0.10, f"home-zoom bike corridor still recedes ({home_k:.3f} khaki)"
        assert home_lime < 0.12, f"home-zoom bike paint drifted to neon lime ({home_lime:.3f})"

        def sample_lot(name):
            page.evaluate("repo => window.__AXP.select(repo)", name)
            page.wait_for_function("repo => window.__AXP.diagnostics().selected === repo", arg=name)
            page.wait_for_timeout(350)
            return page.evaluate("([repo, grid]) => window.__AXP.lotPixels(repo, grid)", [name, 6])

        a = sample_lot("studio/lot-00")
        b = sample_lot("studio/lot-11")
        c = sample_lot("studio/lot-22")
        def dist(x, y):
            return sum(sum((p - q) ** 2 for p, q in zip(ca, cb)) ** 0.5 for ca, cb in zip(x["cells"], y["cells"])) / len(x["cells"])
        assert dist(a, b) > 8 or dist(a, c) > 8 or dist(b, c) > 8, "sampled repo lots render too similarly"

        for name in ("compass", "minimap", "zoom-in", "zoom-out", "home", "census", "capture", "svg", "motion", "follow", "status", "dpad", "move-east"):
            point = hud(page, name)
            assert point["width"] > 8 and point["height"] > 8
        for name, label in (
            ("census", "CENSUS"),
            ("capture", "CAPTURE"),
            ("svg", "SVG MAP"),
            ("motion", "MOTION ON"),
            ("follow", "FOLLOW"),
        ):
            assert_kit_label(page, name, label)

        click_hud(page, "census")
        page.wait_for_function("window.__AXP.diagnostics().censusOpen === true")
        census = page.evaluate("window.__AXP.diagnostics()")
        frame = census["censusFrame"]
        assert frame and frame["width"] <= 460, f"census still curtains the city ({frame})"
        assert frame["height"] <= 560, f"census still runs the full viewport ({frame})"
        assert census["cardVisible"] is False, "inspect card must yield while the census sheet is open"
        page.screenshot(path=str(SHOTS / "tileset-hud-census.png"), full_page=False)
        ledger = SHOTS / "tileset-hud-census-ledger.png"
        page.screenshot(path=str(ledger), clip={"x": 16, "y": 98, "width": int(frame["width"]), "height": 200})
        title = SHOTS / "tileset-hud-census-title.png"
        page.screenshot(path=str(title), clip={"x": 32, "y": 110, "width": 180, "height": 24})
        title_ink = cream_ink_width(title)
        assert 75 <= title_ink <= 150, f"census title stamp still dense or doubled ({title_ink}px, expected ~90px for 15px LOT CENSUS)"
        click_hud(page, "census")

        page.locator("#repo-search").fill("studio/lot-00")
        page.locator("#repo-search").press("Enter")
        page.wait_for_function("window.__AXP.diagnostics().selected === 'studio/lot-00'")
        page.wait_for_timeout(400)
        page.screenshot(path=str(SHOTS / "tileset-lot-inspect.png"), full_page=False)
        assert hud(page, "card")
        assert hud(page, "close-card")

        second = browser.new_page(viewport=dict(width=1600, height=1000))
        ready(second, server.url)
        other = second.evaluate("window.__AXP.diagnostics()")
        assert other["office"]["sprite"] == "office"
        assert other["uniqueFacades"] == info["uniqueFacades"]
        second.close()
    finally:
        page.close()
        server.stop()
