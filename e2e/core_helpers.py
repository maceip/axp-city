"""Browser acceptance helpers for the core city. All mutations use visible UI."""
from pathlib import Path

from PIL import Image, ImageStat

from conftest import wait_js

SHOTS = Path(__file__).parent / "screenshots" / "core"


def core_ready(page, url, query=""):
    response = page.goto(url + "/city" + query, wait_until="domcontentloaded")
    assert response and response.ok
    # Keep the production policy in force: no bypass_csp browser context and no
    # unsafe-eval exception just to make browser polling pass.
    policy = response.headers.get("content-security-policy", "")
    assert "script-src" in policy and "'unsafe-eval'" not in policy, policy
    wait_js(page, "() => Boolean(window.__CORE) && window.__CORE.diagnostics().buildings > 0")
    page.locator("canvas").wait_for(state="visible")
    page.locator("[data-tool='road']").wait_for(state="visible")
    return policy


def diagnostics(page):
    return page.evaluate("() => window.__CORE.diagnostics()")


def snapshot(page):
    return page.evaluate("() => window.__CORE.snapshot()")


def cell(state, x, y):
    return state["cells"][(y - state["minY"]) * state["width"] + x - state["minX"]]


def choose(page, tool):
    page.locator(f"[data-tool='{tool}']").click()
    wait_js(page, "tool => window.__CORE.diagnostics().selectedTool === tool", arg=tool)


def click_cell(page, x, y):
    point = page.evaluate("p => window.__CORE.cellScreen(p.x, p.y)", dict(x=x, y=y))
    box = page.locator("canvas").bounding_box()
    assert box and box["x"] <= point["x"] <= box["x"] + box["width"], point
    assert box["y"] <= point["y"] <= box["y"] + box["height"], point
    page.mouse.click(point["x"], point["y"])


def pause(page, paused=True):
    if diagnostics(page)["paused"] != paused:
        page.locator("[data-action='pause']").click()
    wait_js(page, "paused => window.__CORE.diagnostics().paused === paused", arg=paused)


def photograph(page, name):
    """Save full context plus canvas-only evidence and reject a blank output.

    This pixel sanity check is not an aesthetic approval; the saved views still
    require human/agent inspection for seams, scale, readability, and occlusion.
    """
    SHOTS.mkdir(parents=True, exist_ok=True)
    full = SHOTS / f"{name}.png"
    canvas = SHOTS / f"{name}-canvas.png"
    page.screenshot(path=str(full), full_page=False)
    page.locator("canvas").screenshot(path=str(canvas))
    with Image.open(canvas) as image:
        rgb = image.convert("RGB")
        assert max(ImageStat.Stat(rgb).stddev) > 12, "Rendered map is blank or almost uniform"
        colors = rgb.resize((256, 256)).getcolors(65536) or []
        assert len(colors) > 32, "Rendered map has almost no visual detail"
        assert sum(count for count, pixel in colors if max(pixel) < 16) / (256 * 256) < .05, "Terrain rendered as black tiles"
    return full
