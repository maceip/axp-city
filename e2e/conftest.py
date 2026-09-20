"""Exercise the production Phaser build and real HTTP/SSE server in isolation."""
import hashlib
import hmac
import json
import os
import platform
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

REPO = Path(__file__).resolve().parent.parent
SECRET = "local-browser-test-secret"
ADMIN = "local-browser-test-admin"

# These suites exercise the retained GitHub-city client, which is no longer the
# default /city experience. Keep them discoverable without confusing their old
# selector failures with regressions in the core engine. Backend suites stay on.
LEGACY_UI_SUITES = {
    "test_city_visual.py", "test_exports.py", "test_live_github.py",
    "test_live_local.py", "test_performance.py", "test_support.py",
    "test_tileset_revamp.py", "test_trending_city.py",
}


def pytest_addoption(parser):
    parser.addoption("--legacy-ui", action="store_true", help="Include UI tests for the retained, superseded GitHub-city renderer")
    parser.addoption("--performance", action="store_true", help="Include timing benchmarks; run separately on an otherwise idle machine")


def pytest_configure(config):
    config.addinivalue_line("markers", "legacy_ui: targets the superseded GitHub-city interface, opt in with --legacy-ui")
    config.addinivalue_line("markers", "performance: timing benchmark, opt in with --performance")


def pytest_collection_modifyitems(config, items):
    excluded = []
    included = []
    for item in items:
        legacy = item.path.name in LEGACY_UI_SUITES
        if legacy:
            item.add_marker(pytest.mark.legacy_ui)
        performance = item.get_closest_marker("performance") is not None
        if (legacy and not config.getoption("--legacy-ui")) or (performance and not config.getoption("--performance")):
            excluded.append(item)
        else:
            included.append(item)
    if excluded:
        config.hook.pytest_deselected(items=excluded)
        items[:] = included


def repo_metrics(name, **kw):
    now = datetime.now(timezone.utc)
    owner, short = name.split("/")
    value = dict(owner=owner, name=short, fullName=name, url=f"https://github.com/{name}", description="Browser fixture", stars=100, forks=4, openIssues=0, openPrs=0, sizeKb=100, languageBytes={}, primaryLanguage="TypeScript", pushedAt=(now-timedelta(days=400)).isoformat(), updatedAt=now.isoformat(), recentDefaultCommits=0, recentAuthors=[], prAuthors=[], fetchedAt=now.isoformat(), source="fixture")
    value.update(kw)
    return value


def fixture_metrics():
    return [repo_metrics("acme/forge", stars=25000, openPrs=20, openIssues=5, recentDefaultCommits=1), repo_metrics("acme/robots", stars=12000, openPrs=4, recentDefaultCommits=2, prAuthors=[dict(login="dependabot[bot]", type="Bot")]), repo_metrics("acme/plans", openIssues=4, recentDefaultCommits=1), repo_metrics("acme/quiet"), repo_metrics("acme/idle", recentDefaultCommits=1), repo_metrics("acme/botidle", recentDefaultCommits=1, recentAuthors=["renovate[bot]"]), repo_metrics("acme/stale", stars=45000, openPrs=3), repo_metrics("acme/annex", openIssues=2)]


class CityServer:
    def __init__(self, root, metrics, live=False, env=None, extra_env=None, core=False):
        self.root = root
        self.metrics = metrics
        self.live = live
        self.core = core
        self.extra_env = extra_env or env or {}
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
            # Production live default is Trending City. A successful trending fetch
            # withdraws any lot not on that list, so an isolated live rehearsal
            # (acme/alpha, maceip/axp-city) would vanish mid-test. Tests that want
            # trending set CITY_TRENDING / CITY_TRENDING_FIXTURE themselves.
            env.setdefault("CITY_TRENDING", "0")
        else:
            env.update(CITY_OFFLINE="1", CITY_FIXTURE_PATH=str(self.file))
        env.update(self.extra_env)
        self.log = (self.root / "server.log").open("a")
        command = ["node", "dist/server/cli/server.js", "--port", str(self.port)]
        if self.core:
            command.append("--core")
        self.proc = subprocess.Popen(command, cwd=REPO, env=env, stdout=self.log, stderr=subprocess.STDOUT)
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
def core_server(tmp_path, request):
    """The default lightweight server: no repository ingestion or database."""
    runtime = CityServer(tmp_path, [], core=True)
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


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args, browser_name):
    """Add the renderer profile while pytest-playwright owns browser lifecycle."""
    options = dict(browser_type_launch_args)
    if os.environ.get("CITY_CORE_HARDWARE") == "1":
        if platform.system() != "Darwin" or browser_name != "chromium":
            raise pytest.UsageError("CITY_CORE_HARDWARE=1 requires macOS and --browser chromium")
        options.update(headless=False, args=["--use-gl=angle", "--use-angle=metal"])
    elif browser_name == "chromium" and os.environ.get("CITY_SOFTWARE_GL") == "1":
        options["args"] = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    elif browser_name == "firefox":
        options["firefox_user_prefs"] = {"webgl.force-enabled": True, "webgl.disabled": False}
    return options


class BrowserBackend:
    """Compatibility report descriptor for retained historical UI tests."""

    def __init__(self, browser, engine):
        self.browser = browser
        self.kind = f"local-{engine}"
        self.engine = engine

    def describe(self):
        return dict(backend=self.kind, browser=self.browser.version, engine=self.engine)


@pytest.fixture
def backend(browser, browser_name):
    return BrowserBackend(browser, browser_name)


def wait_js(page, predicate, *, arg=None, timeout=30000, interval=50):
    """Poll a function directly through the browser protocol, preserving production CSP.

    Playwright's wait_for_function reconstructs its predicate with eval in the page,
    which a strict script-src correctly rejects. evaluate sends a function directly;
    keep the timeout/retry loop here instead of weakening the application's CSP.
    JavaScript errors deliberately propagate rather than masquerading as timeouts.
    """
    if "=>" not in predicate and not predicate.lstrip().startswith("function"):
        raise ValueError("wait_js requires a JavaScript function, not an expression")
    deadline = time.monotonic() + timeout / 1000
    last = None
    while time.monotonic() < deadline:
        last = page.evaluate(predicate, arg)
        if last:
            return last
        page.wait_for_timeout(interval)
    raise TimeoutError(f"Browser condition did not pass within {timeout} ms: {predicate}; last={last!r}")


def ready(page, url):
    page.goto(url + "/city", wait_until="domcontentloaded")
    wait_js(page, "() => Boolean(window.__AXP) && window.__AXP.diagnostics().chunks > 0")
    page.locator("#boot-card").wait_for(state="hidden")


class HeapMeter:
    """Retained JS heap of a page, measured rather than read from `performance.memory`.

    Chromium quantises `performance.memory.usedJSHeapSize` and refreshes it only every
    ~20 minutes, so a soak that grows the city sees one step and no trend. Through CDP
    the page's garbage is collected first and the live heap read exactly
    (`Runtime.getHeapUsage`), which is what a leak check needs. Other engines expose no
    equivalent; `read()` returns None there and the callers say so."""

    def __init__(self, page):
        self.session = None
        if page.context.browser and page.context.browser.browser_type.name == "chromium":
            self.session = page.context.new_cdp_session(page)
            self.session.send("HeapProfiler.enable")

    def read(self):
        if self.session is None:
            return None
        self.session.send("HeapProfiler.collectGarbage")
        return int(self.session.send("Runtime.getHeapUsage")["usedSize"])


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
