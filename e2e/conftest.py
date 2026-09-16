"""Exercise the production Phaser build and real HTTP/SSE server in isolation."""
import hashlib
import hmac
import json
import os
import re
import shutil
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
    def __init__(self, root, metrics, live=False, env=None):
        self.root = root
        self.metrics = metrics
        self.live = live
        self.extra_env = env or {}
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
        # Atomic replace: the server re-reads this file on every refresh, and a
        # truncate-then-write could be observed half-written as a parse failure.
        tmp = self.file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.metrics))
        os.replace(tmp, self.file)

    def start(self):
        env = dict(os.environ, CITY_DATA_DIR=str(self.root / "data"), CITY_RULES_DIR=str(self.rules), GITHUB_WEBHOOK_SECRET=SECRET, CITY_ADMIN_TOKEN=ADMIN, HOST="127.0.0.1")
        if self.live:
            # Real GitHub through GITHUB_TOKEN from the environment; nothing is enrolled
            # until a test does so, and no fixture file is in reach of the resolver.
            env.pop("CITY_OFFLINE", None)
            env["CITY_ENROLL_FILE"] = os.devnull
        else:
            env.update(CITY_OFFLINE="1", CITY_FIXTURE_PATH=str(self.file))
        env.update(self.extra_env)
        self.log = (self.root / "server.log").open("a")
        self.proc = subprocess.Popen(["node", "dist/server/cli/server.js", "--port", str(self.port)], cwd=REPO, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        # A loaded CI runner (browser + server on two cores) can take well over five
        # seconds to open SQLite and start listening; a crash is still reported at once.
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                if self.get("/healthz")["renderer"] == "phaser-4": return
            except (OSError, urllib.error.URLError): pass
            if self.proc.poll() is not None: raise RuntimeError((self.root / "server.log").read_text())
            time.sleep(.05)
        raise RuntimeError("City server did not start within 60 s:\n" + (self.root / "server.log").read_text()[-4000:])

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

    def enroll(self, repo):
        """Administrative enrollment: the only way a new repository joins the city."""
        body = json.dumps(dict(repo=repo)).encode()
        request = urllib.request.Request(self.url + "/api/city/lots", data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {ADMIN}"})
        with urllib.request.urlopen(request, timeout=20) as response: return response.status

    def repo_rules(self, repo, **files):
        """Repository rule files (`.city/*.json`) for fixture mode, under <rules>/repos/<owner>/<name>/."""
        folder = self.rules / "repos" / repo
        folder.mkdir(parents=True, exist_ok=True)
        for name, value in files.items():
            (folder / f"{name.replace('_', '-')}.json").write_text(value if isinstance(value, str) else json.dumps(value))

    def webhook(self, repo, delivery="test-1"):
        return self.webhook_event("push", dict(ref="refs/heads/main", repository=dict(full_name=repo), sender=dict(login="human")), delivery)

    def webhook_event(self, event, payload, delivery):
        body = json.dumps(payload).encode()
        signature = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        request = urllib.request.Request(self.url + "/webhooks/github", data=body, headers={"Content-Type":"application/json", "X-GitHub-Event":event, "X-GitHub-Delivery":delivery, "X-Hub-Signature-256":signature})
        with urllib.request.urlopen(request, timeout=10) as response: return response.status


SERVER_LOGS = Path(__file__).parent / "screenshots" / "server-logs"


def keep_server_log(runtime, request):
    """Copy the server's log next to the screenshots so CI evidence includes what the
    server did (delivery failures, retries) and not only what the browser saw."""
    runtime.stop()
    source = runtime.root / "server.log"
    if source.exists():
        SERVER_LOGS.mkdir(parents=True, exist_ok=True)
        name = re.sub(r"[^A-Za-z0-9_.-]+", "_", request.node.name)
        shutil.copyfile(source, SERVER_LOGS / f"{name}.log")


@pytest.fixture
def server(tmp_path, request):
    runtime = CityServer(tmp_path, fixture_metrics())
    yield runtime
    keep_server_log(runtime, request)


@pytest.fixture
def live_server(tmp_path, request):
    """The real resolver against GitHub. Skipped without a token so the suite never
    pretends live coverage it did not get."""
    if not os.environ.get("GITHUB_TOKEN"):
        pytest.skip("GITHUB_TOKEN is not set; live GitHub coverage was not run")
    runtime = CityServer(tmp_path, [], live=True, env={"CITY_REFRESH_INTERVAL_MS": "15000", "CITY_STALE_AFTER_MS": "600000"})
    yield runtime
    keep_server_log(runtime, request)


@pytest.fixture
def large_server(tmp_path, request):
    rows = [repo_metrics(f"bench/repo{i}", stars=i*83, openPrs=i%20, recentDefaultCommits=1) for i in range(1000)]
    runtime = CityServer(tmp_path, rows)
    yield runtime
    keep_server_log(runtime, request)


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
    engine = os.environ.get("CITY_BROWSER", "chromium")
    headless = os.environ.get("HEADED") != "1"
    if engine == "firefox":
        browser = p.firefox.launch(headless=headless, firefox_user_prefs={"webgl.force-enabled": True, "webgl.disabled": False})
        return BrowserBackend("local-firefox", browser, dict(engine="firefox", softwareGl=None, webglDisabled=False))
    if engine == "webkit":
        browser = p.webkit.launch(headless=headless)
        return BrowserBackend("local-webkit", browser, dict(engine="webkit", softwareGl=None, webglDisabled=False, note="Playwright WebKit on Linux, not Safari on macOS/iOS"))
    software = os.environ.get("CITY_SOFTWARE_GL") == "1"
    args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] if software else []
    if os.environ.get("CITY_DISABLE_WEBGL") == "1":
        args += ["--disable-webgl", "--disable-webgl2"]
    browser = p.chromium.launch(headless=headless, args=args)
    return BrowserBackend("local-chromium", browser, dict(engine="chromium", softwareGl=software, webglDisabled=os.environ.get("CITY_DISABLE_WEBGL") == "1"))


def engine_name(browser):
    return browser.browser_type.name


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


def settled(page, timeout=10000):
    """Wait until the camera has stopped moving (a key press still pans the frame after
    it resolves on a slow renderer), then return the diagnostics of that resting state."""
    read = "() => { const c = window.__AXP.scene.cameras.main; return [c.scrollX, c.scrollY, c.zoom, c.panEffect.isRunning || c.zoomEffect.isRunning]; }"
    deadline = time.monotonic() + timeout / 1000
    previous = None
    while time.monotonic() < deadline:
        current = page.evaluate(read)
        if current == previous and not current[3]:
            return page.evaluate("window.__AXP.diagnostics()")
        previous = current
        page.wait_for_timeout(250)
    raise TimeoutError(f"camera still moving after {timeout} ms: {previous}")


def webgl_available(page):
    """Whether this browser gave the client a WebGL context (headless Firefox on a CI
    runner without a GPU does not; the client then uses the documented Canvas fallback)."""
    return page.evaluate("window.__AXP_SUPPORT.renderer") == "webgl"


@pytest.fixture
def page(browser, server):
    page = browser.new_page(viewport=dict(width=1600, height=1000))
    ready(page, server.url)
    yield page
    page.close()
