"""Browser and device support: Canvas fallback, unsupported screen, context loss, resize."""
from pathlib import Path

import pytest

from conftest import ready, settled, webgl_available

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)


def test_canvas_renderer_fallback_draws_the_same_city(browser, server):
    page = browser.new_page(viewport=dict(width=1400, height=900))
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(server.url + "/city?renderer=canvas", wait_until="domcontentloaded")
    page.wait_for_function("Boolean(window.__AXP) && window.__AXP.diagnostics().chunks > 0", timeout=45000)
    state = page.evaluate("window.__AXP.diagnostics()")
    assert state["renderer"] == 1 and state["rendererName"] == "canvas"
    assert state["visibleLots"] == 8 and state["actors"] > 0
    support = page.evaluate("window.__AXP_SUPPORT")
    assert support["renderer"] == "canvas" and any("forced" in r for r in support["reasons"])
    page.evaluate("window.__AXP.select('acme/forge')")
    page.wait_for_function("window.__AXP.diagnostics().cardVisible")
    page.wait_for_timeout(1000)
    page.screenshot(path=str(SHOTS / "canvas-fallback.png"))
    assert not errors, errors
    page.close()


def test_unsupported_browser_gets_an_explicit_error_screen(browser, server):
    context = browser.new_context(viewport=dict(width=1000, height=700))
    context.add_init_script("HTMLCanvasElement.prototype.getContext = function () { return null; };")
    page = context.new_page()
    page.goto(server.url + "/city", wait_until="domcontentloaded")
    page.locator("#unsupported").wait_for(state="visible", timeout=15000)
    text = page.locator("#unsupported").inner_text()
    assert "cannot run the city" in text and "SUPPORT.md" in page.content()
    assert page.locator("#game canvas").count() == 0
    assert page.evaluate("window.__AXP_SUPPORT.renderer") is None
    page.screenshot(path=str(SHOTS / "unsupported.png"))
    context.close()


def test_failed_sprite_sheets_are_reported_and_the_city_still_draws(browser, server):
    """A sheet that cannot be fetched and one that cannot be decoded both end up in
    `assetsFailed`; nothing stays in flight forever and the lots are still drawn."""
    context = browser.new_context(viewport=dict(width=1400, height=900))
    context.route("**/assets/sprites/v2-raw-materials-k1.png", lambda r: r.abort())
    context.route("**/assets/sprites/v7-anim-cargo-drone.png", lambda r: r.fulfill(status=200, content_type="image/png", body=b"not a png"))
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    ready(page, server.url)
    page.wait_for_function("window.__AXP.diagnostics().assetsFailed.length >= 2 && window.__AXP.diagnostics().assetsInflight === 0", timeout=30000)
    state = page.evaluate("window.__AXP.diagnostics()")
    assert "v2-raw-materials-k1.png" in state["assetsFailed"] and "cargoDrone" in state["assetsFailed"], state["assetsFailed"]
    assert state["visibleLots"] == 8 and state["chunks"] > 0
    # A lot that needs the missing sheets is complete as far as the renderer is concerned:
    # it is not rebuilt every refresh waiting for something that will never arrive.
    page.evaluate("window.__AXP.select('acme/forge')")
    page.wait_for_function("window.__AXP.diagnostics().cardVisible")
    page.wait_for_timeout(500)
    drawn = page.evaluate("window.__AXP.drawn('acme/forge')")
    assert drawn and not drawn["incomplete"] and drawn["objects"] > 0, drawn
    assert not errors, errors
    page.screenshot(path=str(SHOTS / "failed-sheets.png"))
    context.close()


def test_webgl_context_loss_recovers_camera_and_selection(page):
    if not webgl_available(page):
        pytest.skip("this browser runs the Canvas fallback; there is no WebGL context to lose")
    page.evaluate("window.__AXP.select('acme/robots')")
    page.wait_for_function("window.__AXP.diagnostics().cardVisible")
    page.keyboard.press("d")
    before = settled(page)
    lost = page.evaluate(
        """() => { const gl = window.__AXP.game.renderer.gl; const ext = gl.getExtension('WEBGL_lose_context'); if (!ext) return false; window.__AXP_EXT = ext; ext.loseContext(); return true; }"""
    )
    assert lost, "WEBGL_lose_context is unavailable in this browser"
    page.wait_for_timeout(600)
    page.evaluate("window.__AXP_EXT.restoreContext()")
    # The restored scene is a new run (generation + 1) that republishes the handle; the
    # pre-loss handle must not be mistaken for it.
    page.wait_for_function(
        "g => Boolean(window.__AXP) && window.__AXP.diagnostics().generation > g && window.__AXP.diagnostics().chunks > 0 && window.__AXP.diagnostics().selected === 'acme/robots'",
        arg=before["generation"],
        timeout=30000,
    )
    after = page.evaluate("window.__AXP.diagnostics()")
    assert after["generation"] == before["generation"] + 1
    assert abs(after["scrollX"] - before["scrollX"]) < 2 and abs(after["zoom"] - before["zoom"]) < 0.001
    assert after["visibleLots"] > 0 and after["actors"] > 0
    page.wait_for_timeout(800)
    page.screenshot(path=str(SHOTS / "context-restored.png"))


def test_resize_and_orientation_relayout_the_hud(page):
    for width, height in [(900, 1200), (1200, 700), (600, 900)]:
        page.set_viewport_size(dict(width=width, height=height))
        page.wait_for_timeout(300)
        for name in ["minimap", "zoom-in", "compass", "status"]:
            point = page.evaluate("name => window.__AXP.hudPoint(name)", name)
            assert point and 0 <= point["x"] <= width and 0 <= point["y"] <= height, (name, width, height, point)
        assert page.evaluate("document.documentElement.scrollWidth") == width
    page.screenshot(path=str(SHOTS / "resize-narrow.png"))
