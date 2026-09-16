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


def click_hud(page, name):
    p = hud(page, name)
    page.mouse.click(p["x"], p["y"])


def cream_ink_width(path: Path) -> int:
    """Width of cream HUD lettering. SwiftShader fillText grows this past the word."""
    image = Image.open(path).convert("RGB")
    xs = []
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = image.getpixel((x, y))
            if r > 200 and g > 190 and b > 150:
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
        assert info["roadStampWidth"] >= 140, f"roads still stamp too small: {info['roadStampWidth']}"
        assert info["bikeStampWidth"] >= 180, f"bike lanes still stamp too small: {info['bikeStampWidth']}"
        assert info["uniqueFacades"] >= 12, f"repo lots still look cloned: {info['uniqueFacades']} unique facades"

        click_hud(page, "zoom-out")
        click_hud(page, "zoom-out")
        page.wait_for_timeout(400)
        page.screenshot(path=str(SHOTS / "tileset-city-overview.png"), full_page=False)
        page.screenshot(path=str(SHOTS / "tileset-roads-bikes-civics.png"), full_page=False)

        click_hud(page, "home")
        page.wait_for_timeout(500)
        page.screenshot(path=str(SHOTS / "tileset-center-office.png"), full_page=False)
        page.screenshot(path=str(SHOTS / "tileset-street-home.png"), full_page=False)

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
