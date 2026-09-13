"""Shared fixtures: render a deterministic city, serve it, drive Chromium.

Run with the home venv: ``~/.venv/bin/python -m pytest e2e -v``.
Set ``HEADED=1`` to watch the browser.
"""

import json
import os
import posixpath
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets" / "city-sprites"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


def _repo_metrics(owner, name, **kw):
    """One RepoMetrics record; defaults mirror test/helpers.ts."""
    now = datetime.now(timezone.utc)
    base = {
        "owner": owner,
        "name": name,
        "fullName": f"{owner}/{name}",
        "url": f"https://github.com/{owner}/{name}",
        "description": "e2e fixture",
        "stars": 100,
        "forks": 10,
        "openIssues": 0,
        "openPrs": 0,
        "sizeKb": 1200,
        "languageBytes": {"TypeScript": 80000},
        "primaryLanguage": "TypeScript",
        "pushedAt": (now - timedelta(days=400)).isoformat(),
        "updatedAt": (now - timedelta(days=400)).isoformat(),
        "recentDefaultCommits": 0,
        "recentAuthors": [],
        "prAuthors": [],
        "fetchedAt": now.isoformat(),
        "source": "e2e",
    }
    base.update(kw)
    return base


def _recent_iso(days_ago=3):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


HUMAN = {"login": "human", "type": "User"}
BOT = {"login": "dependabot[bot]", "type": "Bot"}


def fixture_metrics():
    """Eight lots covering every yard kind, human and bot activity."""
    recent = _recent_iso()
    return [
        # prs_active, human, high pressure (parked-drone + animated crew).
        _repo_metrics("acme", "forge", fullName="acme/forge",
                      openPrs=20, pushedAt=recent, prAuthors=[HUMAN]),
        # prs_active, bot-tended (robot crew + crane + airlift).
        _repo_metrics("acme", "robots", fullName="acme/robots", stars=12000,
                      openPrs=4, openIssues=2, pushedAt=recent,
                      prAuthors=[BOT]),
        # issues_active, human (reader + table).
        _repo_metrics("acme", "plans", fullName="acme/plans",
                      openIssues=5, pushedAt=recent),
        # issues_active, bot-tended (crane from plans, dog patrol).
        _repo_metrics("acme", "botplans", fullName="acme/botplans",
                      openIssues=5, pushedAt=recent,
                      recentAuthors=["renovate[bot]"]),
        # idle_active, human (lone walker).
        _repo_metrics("acme", "idle", fullName="acme/idle",
                      pushedAt=recent),
        # idle_active, bot-tended (dog patrol).
        _repo_metrics("acme", "botidle", fullName="acme/botidle",
                      pushedAt=recent, recentAuthors=["github-actions[bot]"]),
        # prs_quiet, stale high pressure (parked dimmed quad).
        _repo_metrics("acme", "old", fullName="acme/old", openPrs=20),
        # fully_dormant (dimmed building only).
        _repo_metrics("acme", "dead", fullName="acme/dead"),
    ]


class CityHandler(BaseHTTPRequestHandler):
    """Serve the rendered out dir at / and sprite PNGs at /assets/sprites/."""

    out_dir = ""
    assets_dir = ""

    def log_message(self, *args):
        pass

    def _send_file(self, path):
        try:
            data = Path(path).read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("content-type",
                         MIME.get(Path(path).suffix, "application/octet-stream"))
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        raw = urlsplit(self.path).path
        if raw in ("/", "/city.html"):
            return self._send_file(os.path.join(self.out_dir, "city.html"))
        if raw.startswith("/assets/sprites/"):
            rel = posixpath.normpath(unquote(raw[len("/assets/sprites/"):]))
            if rel.startswith("..") or os.path.isabs(rel):
                return self.send_error(404)
            return self._send_file(os.path.join(self.assets_dir, rel))
        return self.send_error(404)


@pytest.fixture(scope="session")
def e2e_out(tmp_path_factory):
    """Render the fixture city into an isolated dir (repo tree untouched)."""
    out = tmp_path_factory.mktemp("city")
    (out / "metrics.json").write_text(
        json.dumps(fixture_metrics()), encoding="utf8")
    subprocess.run(
        ["npm", "run", "render", "--", "--out", str(out)],
        cwd=REPO, check=True, capture_output=True, text=True,
    )
    assert (out / "city.html").exists()
    return out


@pytest.fixture(scope="session")
def server(e2e_out):
    CityHandler.out_dir = str(e2e_out)
    CityHandler.assets_dir = str(ASSETS)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), CityHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright

    headed = os.environ.get("HEADED") == "1"
    with sync_playwright() as p:
        bw = p.chromium.launch(headless=not headed)
        yield bw
        bw.close()


@pytest.fixture()
def page(browser, server):
    failures = []
    pg = browser.new_page(viewport={"width": 1600, "height": 1000})
    pg.on("requestfailed",
          lambda r: failures.append(f"{r.url} :: {r.failure}"))
    pg.on("response",
          lambda r: failures.append(f"{r.url} :: HTTP {r.status}")
          if r.status >= 400 else None)
    pg.goto(f"{server}/city.html")
    pg.wait_for_selector("#axp-map")
    yield pg, failures, server
    pg.close()
