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
        assert khaki >= 0.14, f"overview bike corridor still recedes as asphalt ({khaki:.3f} khaki)"
        assert khaki + cream >= 0.20, f"overview khaki+chevron share still too thin ({khaki + cream:.3f})"
        assert lime < 0.12, f"overview bike paint drifted to neon lime ({lime:.3f})"
        corridor = page.evaluate("window.__AXP.featureScreenBox('freeway-bike-lane')")
        assert corridor and corridor["width"] > 80 and corridor["height"] > 20, f"freeway bike screen box missing: {corridor}"
        clip = {
            "x": max(0, corridor["x"]),
            "y": max(0, corridor["y"]),
            "width": min(1600, corridor["x"] + corridor["width"]) - max(0, corridor["x"]),
            "height": min(1000, corridor["y"] + corridor["height"]) - max(0, corridor["y"]),
        }
        assert clip["width"] > 40 and clip["height"] > 16, f"freeway bike clip off-screen: {clip}"
        page.screenshot(path=str(SHOTS / "tileset-freeway-bike.png"), clip=clip)
        fw_k, fw_c, fw_lime = street_lane_share(SHOTS / "tileset-freeway-bike.png", (0, 0, int(clip["width"]), int(clip["height"])))
        assert fw_k >= 0.10, f"freeway bike clip still recedes ({fw_k:.3f} khaki)"
        assert fw_k + fw_c >= 0.16, f"freeway bike clip khaki+chevron still thin ({fw_k + fw_c:.3f})"
        assert fw_lime < 0.12, f"freeway bike clip drifted to neon lime ({fw_lime:.3f})"

        click_hud(page, "home")
        page.wait_for_timeout(500)
        page.screenshot(path=str(SHOTS / "tileset-center-office.png"), full_page=False)
        page.screenshot(path=str(SHOTS / "tileset-street-home.png"), full_page=False)
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
        page.screenshot(path=str(SHOTS / "tileset-hud-census.png"), full_page=False)
        ledger = SHOTS / "tileset-hud-census-ledger.png"
        page.screenshot(path=str(ledger), clip={"x": 16, "y": 98, "width": 680, "height": 200})
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
