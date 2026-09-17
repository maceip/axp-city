"""Exports: Phaser image capture, SVG from the shared plan, and the offline package."""
import base64
import http.server
import json
import time
import socket
import struct
import subprocess
import threading
import urllib.request
import xml.etree.ElementTree as ET
from functools import partial
from pathlib import Path

from conftest import REPO, ready

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)
SVG_NS = "{http://www.w3.org/2000/svg}"


def png_size(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def test_phaser_image_capture_downloads_the_composited_city(page):
    page.evaluate("window.__AXP.select('acme/forge')")
    page.wait_for_function("window.__AXP.diagnostics().cardVisible")
    with page.expect_download() as info:
        page.evaluate("window.__AXP.capture()")
    download = info.value
    assert download.suggested_filename.startswith("axp-city-r") and download.suggested_filename.endswith(".png")
    target = SHOTS / "capture.png"
    download.save_as(str(target))
    data = target.read_bytes()
    width, height = png_size(data)
    assert (width, height) == (1600, 1000)
    assert len(data) > 60_000, "capture is suspiciously small (blank canvas?)"
    data_url = page.evaluate("window.__AXP_LAST_CAPTURE")
    assert data_url.startswith("data:image/png;base64,")
    assert png_size(base64.b64decode(data_url.split(",", 1)[1])) == (1600, 1000)


def test_svg_export_matches_the_shared_plan_and_renders(page, server):
    sha = approve_artwork(server, "acme/forge", "svg-art")
    snapshot = server.get("/api/city")
    with urllib.request.urlopen(server.url + "/api/city/export.svg", timeout=10) as response:
        assert response.headers["content-type"].startswith("image/svg+xml")
        svg = response.read().decode()
    (SHOTS / "export.svg").write_text(svg)
    root = ET.fromstring(svg)
    assert root.attrib["data-lots"] == str(len(snapshot["plan"]["placements"]))
    assert root.attrib["data-revision"] == str(snapshot["revision"])
    lots = [g for g in root.iter(f"{SVG_NS}g") if g.attrib.get("class") == "lot"]
    assert sorted(g.attrib["data-repo"] for g in lots) == sorted(p["lot"]["fullName"] for p in snapshot["plan"]["placements"])
    crews = {g.attrib["data-repo"]: g.attrib["data-crew"] for g in lots}
    assert crews["acme/robots"] == "robot" and crews["acme/forge"] == "human"
    # Every referenced sheet resolves on the same origin.
    hrefs = {img.attrib["href"] for img in root.iter(f"{SVG_NS}image")}
    assert hrefs and all(h.startswith(("/assets/sprites/", "/assets/artwork/")) for h in hrefs)
    forge = next(g for g in lots if g.attrib["data-repo"] == "acme/forge")
    assert f"/assets/artwork/{sha}.png" in {img.attrib["href"] for img in forge.iter(f"{SVG_NS}image")}, "approved artwork is drawn from the shared plan"
    for href in hrefs:
        request = urllib.request.Request(server.url + href, method="HEAD")
        with urllib.request.urlopen(request, timeout=10) as response:
            assert response.status == 200, href
    people = [g for g in root.iter(f"{SVG_NS}g") if g.attrib.get("class") == "person"]
    assert people, "human crews are drawn as figures in the export"
    # The browser renders the document itself; a viewport-sized capture is kept as evidence.
    page.goto(server.url + "/api/city/export.svg")
    page.wait_for_load_state("load")
    assert page.evaluate("document.querySelectorAll('g.lot').length") == len(snapshot["plan"]["placements"])
    page.screenshot(path=str(SHOTS / "export-svg-rendered.png"), timeout=60000)


def approve_artwork(server, repo, delivery):
    """Give ``repo`` an approved custom building so exports have non-catalog artwork to carry."""
    import hashlib
    from test_city_visual import png_bytes
    art = png_bytes(96, 160, (240, 160, 40))
    sha = hashlib.sha256(art).hexdigest()
    folder = server.rules / "repos" / repo
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "building.png").write_bytes(art)
    server.repo_rules(repo, building=dict(version=2, artwork=dict(path=".city/building.png", sha256=sha, width=96, height=160)))
    (server.rules / "approved-artwork.json").write_text(json.dumps(dict(version=1, approved=[dict(repo=repo, sha256=sha)])))
    assert server.webhook(repo, delivery) == 202
    deadline = time.time() + 20
    while time.time() < deadline:
        lot = next(p["lot"] for p in server.get("/api/city")["plan"]["placements"] if p["lot"]["fullName"] == repo)
        if lot.get("artwork", {}).get("sha256") == sha:
            return sha
        time.sleep(0.25)
    raise AssertionError(f"{repo} never received its approved artwork")


def test_offline_package_opens_the_saved_city_without_network(browser, server, tmp_path):
    sha = approve_artwork(server, "acme/forge", "export-art")
    out = tmp_path / "offline"
    result = subprocess.run(["node", "dist/server/cli/export.js", "--from", server.url, "--out", str(out)], cwd=REPO, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert (out / "index.html").exists() and (out / "city.json").exists() and (out / "city.svg").exists()
    saved = json.loads((out / "city.json").read_text())
    assert saved["mode"] == "offline" and len(saved["plan"]["placements"]) == 8
    html = (out / "index.html").read_text()
    assert 'name="city-offline"' in html and 'src="./assets/' in html and 'src="/assets/' not in html
    sprites = list((out / "assets" / "sprites").glob("*.png"))
    assert len(sprites) >= 12
    # The approved artwork is part of the package, addressed relatively, and the still uses it too.
    forge = next(p["lot"] for p in saved["plan"]["placements"] if p["lot"]["fullName"] == "acme/forge")
    assert forge["artwork"]["url"] == f"./assets/artwork/{sha}.png"
    assert (out / "assets" / "artwork" / f"{sha}.png").exists()
    assert f'href="./assets/artwork/{sha}.png"' in (out / "city.svg").read_text()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(out))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    package_url = f"http://127.0.0.1:{port}"
    context = browser.new_context(viewport=dict(width=1400, height=900))
    blocked = []

    def route(route_, request):
        # blob:/data: URLs are how the loader hands already-fetched bytes to an Image; they
        # are not network access. WebKit routes them through interception, Chromium does not.
        if request.url.startswith(package_url) or request.url.startswith(("blob:", "data:")):
            route_.continue_()
        else:
            blocked.append(request.url)
            route_.abort()

    context.route("**/*", route)
    page = context.new_page()
    try:
        page.goto(package_url + "/index.html", wait_until="domcontentloaded")
        page.wait_for_function("Boolean(window.__AXP) && window.__AXP.diagnostics().chunks > 0", timeout=30000)
        page.locator("#boot-card").wait_for(state="hidden")
        state = page.evaluate("window.__AXP.diagnostics()")
        assert state["connection"] == "offline-package" and state["totalLots"] == 8 and state["mode"] == "offline"
        assert state["revision"] == saved["revision"]
        page.evaluate("window.__AXP.select('acme/forge')")
        page.wait_for_function("window.__AXP.diagnostics().cardVisible")
        # Every on-demand asset the selection needs resolves from the package itself.
        page.wait_for_function("window.__AXP.diagnostics().assetsInflight === 0", timeout=20000)
        page.wait_for_function("s => (window.__AXP.drawnRenderKey('acme/forge') || '').includes(s)", arg=sha, timeout=20000)
        page.wait_for_timeout(600)
        page.screenshot(path=str(SHOTS / "offline-package.png"))
        assert not [b for b in blocked if server.url in b], blocked
        assert not [b for b in blocked if "/assets/" in b or "/api/" in b], blocked
        assert page.evaluate("window.__AXP.diagnostics().assetsFailed") == []
        page.goto(package_url + "/city.svg")
        assert page.evaluate("document.querySelectorAll('g.lot').length") == 8
    finally:
        page.close()
        context.close()
        httpd.shutdown()
