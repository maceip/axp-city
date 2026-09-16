"""Exercise the production Phaser build and real HTTP/SSE server in isolation."""
import hashlib
import hmac
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
SECRET = "local-browser-test-secret"
ADMIN = "local-browser-test-admin"


def repo_metrics(name, **kw):
    now = datetime.now(timezone.utc)
    owner, short = name.split("/")
    value = dict(owner=owner, name=short, fullName=name, url=f"https://github.com/{name}", description="Browser fixture", stars=100, forks=4, openIssues=0, openPrs=0, sizeKb=100, languageBytes={}, primaryLanguage="TypeScript", pushedAt=(now-timedelta(days=400)).isoformat(), updatedAt=now.isoformat(), recentDefaultCommits=0, recentAuthors=[], prAuthors=[], fetchedAt=now.isoformat(), source="fixture")
    value.update(kw)
    return value


def fixture_metrics():
    return [repo_metrics("acme/forge", stars=25000, openPrs=20, openIssues=5, recentDefaultCommits=1), repo_metrics("acme/robots", stars=12000, openPrs=4, recentDefaultCommits=2, prAuthors=[dict(login="dependabot[bot]", type="Bot")]), repo_metrics("acme/plans", openIssues=4, recentDefaultCommits=1), repo_metrics("acme/quiet"), repo_metrics("acme/idle", recentDefaultCommits=1), repo_metrics("acme/botidle", recentDefaultCommits=1, recentAuthors=["renovate[bot]"]), repo_metrics("acme/stale", stars=45000, openPrs=3), repo_metrics("acme/annex", openIssues=2)]


class CityServer:
    def __init__(self, root, metrics):
        self.root = root
        self.metrics = metrics
        self.file = root / "metrics.json"
        self.rules = root / "rules"
        self.rules.mkdir()
        self.save()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self.proc = None
        self.start()

    def save(self):
        self.file.write_text(json.dumps(self.metrics))

    def start(self):
        env = dict(os.environ, CITY_OFFLINE="1", CITY_DATA_DIR=str(self.root / "data"), CITY_FIXTURE_PATH=str(self.file), CITY_RULES_DIR=str(self.rules), GITHUB_WEBHOOK_SECRET=SECRET, CITY_ADMIN_TOKEN=ADMIN, HOST="127.0.0.1")
        self.log = (self.root / "server.log").open("a")
        self.proc = subprocess.Popen(["node", "dist/server/cli/server.js", "--port", str(self.port)], cwd=REPO, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(100):
            try:
                if self.get("/healthz")["renderer"] == "phaser-4": return
            except (OSError, urllib.error.URLError): pass
            if self.proc.poll() is not None: raise RuntimeError((self.root / "server.log").read_text())
            time.sleep(.05)
        raise RuntimeError("City server did not start")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try: self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired: self.proc.kill(); self.proc.wait()
        self.log.close()

    def restart(self):
        self.stop(); self.start()

    def get(self, path):
        with urllib.request.urlopen(self.url + path, timeout=5) as response: return json.load(response)

    def webhook(self, repo, delivery="test-1"):
        body = json.dumps(dict(ref="refs/heads/main", repository=dict(full_name=repo), sender=dict(login="human"))).encode()
        signature = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        request = urllib.request.Request(self.url + "/webhooks/github", data=body, headers={"Content-Type":"application/json", "X-GitHub-Event":"push", "X-GitHub-Delivery":delivery, "X-Hub-Signature-256":signature})
        with urllib.request.urlopen(request, timeout=10) as response: return response.status


@pytest.fixture
def server(tmp_path):
    runtime = CityServer(tmp_path, fixture_metrics())
    yield runtime
    runtime.stop()


@pytest.fixture
def large_server(tmp_path):
    rows = [repo_metrics(f"bench/repo{i}", stars=i*83, openPrs=i%20, recentDefaultCommits=1) for i in range(1000)]
    runtime = CityServer(tmp_path, rows)
    yield runtime
    runtime.stop()


class BrowserBackend:
    """Where the browser under test actually runs. Recorded in every report."""

    def __init__(self, kind, browser, detail):
        self.kind = kind
        self.browser = browser
        self.detail = detail

    def describe(self):
        return dict(backend=self.kind, browser=self.browser.version, **self.detail)


def service_endpoint(url):
    """Azure Playwright Workspaces expects os/runId/api-version query parameters on the workspace URL."""
    run_id = os.environ.get("PLAYWRIGHT_SERVICE_RUN_ID") or f"axp-city-{int(time.time())}"
    target_os = os.environ.get("PLAYWRIGHT_SERVICE_OS", "linux")
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}os={target_os}&runId={run_id}&api-version=2025-09-01", run_id, target_os


def connect_browser(p):
    """Hosted Azure Playwright service first; a local Chromium only when explicitly requested.

    The remote browser reaches the test server on this machine through Playwright's
    client-side network exposure (`<loopback>`), so every test still starts the real
    compiled Node server locally and the browser under test runs in the service.
    """
    url = os.environ.get("PLAYWRIGHT_SERVICE_URL")
    local = os.environ.get("CITY_LOCAL_BROWSER") == "1"
    if url and not local:
        endpoint, run_id, target_os = service_endpoint(url)
        token = os.environ.get("PLAYWRIGHT_SERVICE_ACCESS_TOKEN")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            browser = p.chromium.connect(endpoint, timeout=120_000, expose_network="<loopback>", headers=headers)
        except Exception as error:  # noqa: BLE001 - surface the exact service failure
            hint = "" if token else " No PLAYWRIGHT_SERVICE_ACCESS_TOKEN is set; the workspace rejected the anonymous connection."
            raise RuntimeError(f"Could not connect to the hosted Playwright service at {url.split('?')[0]}: {error}.{hint} Set CITY_LOCAL_BROWSER=1 only to run against a local browser instead.") from error
        return BrowserBackend("azure-playwright-workspaces", browser, dict(service=url.split("/playwrightworkspaces/")[0], runId=run_id, os=target_os, softwareGl=False))
    if not local:
        raise RuntimeError("Browser tests run through the hosted Playwright service. Set PLAYWRIGHT_SERVICE_URL (and PLAYWRIGHT_SERVICE_ACCESS_TOKEN), or set CITY_LOCAL_BROWSER=1 to deliberately use a local Chromium.")
    software = os.environ.get("CITY_SOFTWARE_GL") == "1"
    args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] if software else []
    if os.environ.get("CITY_DISABLE_WEBGL") == "1":
        args += ["--disable-webgl", "--disable-webgl2"]
    browser = p.chromium.launch(headless=os.environ.get("HEADED") != "1", args=args)
    return BrowserBackend("local-chromium", browser, dict(softwareGl=software, webglDisabled=os.environ.get("CITY_DISABLE_WEBGL") == "1"))


@pytest.fixture(scope="session")
def backend():
    with sync_playwright() as p:
        runtime = connect_browser(p)
        yield runtime
        runtime.browser.close()


@pytest.fixture
def browser(backend):
    return backend.browser


def ready(page, url):
    page.goto(url + "/city", wait_until="domcontentloaded")
    page.wait_for_function("Boolean(window.__AXP) && window.__AXP.diagnostics().chunks > 0", timeout=30000)
    page.locator("#boot-card").wait_for(state="hidden")


@pytest.fixture
def page(browser, server):
    page = browser.new_page(viewport=dict(width=1600, height=1000))
    ready(page, server.url)
    yield page
    page.close()
