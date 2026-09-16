"""Live mode end to end without a GitHub credential.

The server runs in *live* mode (not fixtures) with GITHUB_API_URL pointed at
`fake_github.py`, so the real resolver — unauthenticated REST for the repository, pulls,
languages, commits and `.city` rule files — enrollment, deliveries, reconciliation,
staleness, alerts and withdrawal all run against an API the test controls. This is the
part of handoff item 6 and finding F that a token-gated test against api.github.com
cannot rehearse: an outage that begins and ends on cue, a change made while GitHub was
down, an exhausted quota, and a repository turning private.
"""
import json
import time
from pathlib import Path

import pytest

from conftest import CityServer, keep_server_log, ready
from fake_github import FakeGitHub

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)
ALPHA, BETA = "acme/alpha", "acme/beta"


@pytest.fixture
def github():
    fake = FakeGitHub()
    yield fake
    fake.close()


@pytest.fixture
def local_live_server(tmp_path, request, github):
    runtime = CityServer(tmp_path, [], live=True, env={
        "GITHUB_API_URL": github.url,
        "CITY_ALERT_URL": github.url + "/alerts",
        # No credential of any kind: the resolver must take the anonymous REST path.
        "GITHUB_TOKEN": "", "GITHUB_APP_ID": "", "GITHUB_APP_PRIVATE_KEY": "", "GITHUB_APP_INSTALLATION_ID": "",
        # Reconciliation is slow at first so a delivery, not the poll, is what re-fetches.
        "CITY_REFRESH_INTERVAL_MS": "20000", "CITY_STALE_AFTER_MS": "600000",
    })
    yield runtime
    keep_server_log(runtime, request)


def lot(page, repo):
    return page.evaluate("repo => window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName.toLowerCase() === repo.toLowerCase())?.lot", repo)


def diag(page):
    return page.evaluate("window.__AXP.diagnostics()")


def a11y_status(page):
    return page.locator("#a11y-status").inner_text()


def wait_until(predicate, timeout, what):
    deadline = time.time() + timeout
    while not predicate():
        assert time.time() < deadline, what
        time.sleep(0.25)


def test_live_mode_against_a_local_github_reaches_two_browsers_alerts_on_outage_and_recovers(browser, github, local_live_server):
    server = local_live_server
    github.add(ALPHA, stargazers_count=1200, open_issues_count=9, rules={"building.json": dict(version=1, buildingId=7)})
    github.add(BETA, stargazers_count=300, pulls=[], open_issues_count=1,
               commits=[dict(author=dict(login="dependabot[bot]", type="Bot"), commit=dict(author=dict(name="dependabot", date="2026-09-15T09:00:00Z")))])
    first = browser.new_page(viewport=dict(width=1600, height=1000))
    second = browser.new_page(viewport=dict(width=1280, height=800))
    ready(first, server.url)
    ready(second, server.url)
    for tab in (first, second):
        state = diag(tab)
        assert state["mode"] == "live" and state["connection"] == "connected" and state["totalLots"] == 0, state
        assert state["freshness"]["source"] == "github-anonymous", state["freshness"]
        assert "live city" in a11y_status(tab) and "fixture" not in a11y_status(tab).lower(), a11y_status(tab)
    assert server.get("/api/city/status")["freshness"]["source"] == "github-anonymous"

    # 1. Enrollment is administrative and goes through the resolver: repository, pulls,
    #    languages, commits and .city rule files are all read from "GitHub".
    assert server.enroll(ALPHA) in (200, 201)
    assert server.enroll(BETA) in (200, 201)
    for path in (f"/repos/{ALPHA}", f"/repos/{ALPHA}/pulls", f"/repos/{ALPHA}/languages", f"/repos/{ALPHA}/commits", f"/repos/{ALPHA}/contents/.city/building.json"):
        assert github.hits(path), (path, github.requests)
    for tab in (first, second):
        tab.wait_for_function("window.__AXP.diagnostics().totalLots === 2", timeout=30000)
        alpha, beta = lot(tab, ALPHA), lot(tab, BETA)
        assert alpha["stars"] == 1200 and alpha["openIssues"] == 7 and alpha["openPrs"] == 2, alpha  # 9 open_issues_count − 2 PRs
        assert alpha["buildingId"] == 7 and alpha["rulesSource"] == "repository", (alpha["buildingId"], alpha["rulesSource"])
        assert alpha["dataSource"] == "github-rest" and not alpha.get("partial"), alpha
        assert alpha["repoId"] == github.repos[ALPHA]["id"]
        assert beta["stars"] == 300 and beta["occupantClass"] == "robot", (beta["stars"], beta["occupantClass"], beta.get("crewBasis"))
        assert "dependabot" in beta["crewBasis"], beta["crewBasis"]  # the label says why (finding B)
        tab.wait_for_function("window.__AXP.diagnostics().freshness.lastSuccessfulRefreshAt")
        assert "GitHub refresh" in a11y_status(tab) and "STALE" not in a11y_status(tab), a11y_status(tab)

    # 2. A signed push delivery re-fetches through the resolver; both browsers show the change.
    github.set(ALPHA, stargazers_count=4321)
    before = len(github.hits(f"/repos/{ALPHA}"))
    assert server.webhook(ALPHA, "local-live-1") == 202
    for tab in (first, second):
        tab.wait_for_function("r => window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName === r).lot.stars === 4321", arg=ALPHA, timeout=30000)
    assert len(github.hits(f"/repos/{ALPHA}")) > before
    wait_until(lambda: server.get("/api/city/status")["deliveries"]["done"] >= 1, 30, "delivery not completed")
    first.evaluate("r => window.__AXP.select(r)", ALPHA)
    first.wait_for_function("window.__AXP.diagnostics().cardVisible")
    first.wait_for_timeout(600)
    first.screenshot(path=str(SHOTS / "local-live-two-browsers.png"))

    # 3. Faster polling for the outage rehearsal: the browsers reconnect across the restart.
    server.extra_env.update(CITY_REFRESH_INTERVAL_MS="2000", CITY_STALE_AFTER_MS="4000")
    server.restart()
    for tab in (first, second):
        tab.wait_for_function("window.__AXP.diagnostics().connection === 'connected' && window.__AXP.diagnostics().totalLots === 2", timeout=30000)
    wait_until(lambda: github.alerts == [] and server.get("/readyz")["checks"]["githubFresh"], 20, "not fresh after restart")

    # 4. GitHub goes down. Last good values stay, the status plate says STALE (not fresh),
    #    /readyz reports githubFresh=false, and the operator's alert endpoint is posted to.
    github.mode = "outage"
    github.set(BETA, stargazers_count=999)  # a change nobody is told about while GitHub is down
    for tab in (first, second):
        tab.wait_for_function("() => { const f = window.__AXP.diagnostics().freshness; return f.failingRepositories === 2 && Boolean(f.lastError); }", timeout=30000)
        tab.wait_for_function("/STALE/.test(document.querySelector('#a11y-status').textContent)", timeout=30000)
        assert lot(tab, ALPHA)["stars"] == 4321 and lot(tab, BETA)["stars"] == 300, (lot(tab, ALPHA)["stars"], lot(tab, BETA)["stars"])
    wait_until(lambda: "stale" in github.alert_kinds(), 30, ("no stale alert", github.alerts))
    kinds = github.alert_kinds()
    assert "refresh_failures" in kinds, kinds
    stale_alert = next(a for a in github.alerts if a["kind"] == "stale")
    assert stale_alert["text"].startswith("[axp-city] stale:") and stale_alert["freshness"]["failingRepositories"] == 2, stale_alert
    assert server.get("/readyz")["checks"]["githubFresh"] is False and server.get("/api/city/status")["stale"] is True
    first.screenshot(path=str(SHOTS / "local-live-outage-stale.png"))

    # 5. Quota exhaustion is transient: nothing is withdrawn, the lots stay.
    github.mode = "ratelimit"
    time.sleep(3)
    assert server.get("/api/city/status")["lots"] == 2 and server.get("/api/city/status")["withdrawn"] == 0
    for tab in (first, second):
        assert diag(tab)["totalLots"] == 2

    # 6. GitHub is back: the next reconciliation pass recovers the missed change without any
    #    delivery, STALE clears, and the operator hears "recovered".
    github.mode = "ok"
    for tab in (first, second):
        tab.wait_for_function("r => window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName === r).lot.stars === 999", arg=BETA, timeout=30000)
        tab.wait_for_function("() => { const f = window.__AXP.diagnostics().freshness; return f.failingRepositories === 0 && f.lastSuccessfulRefreshAt > (f.lastFailureAt || ''); }", timeout=30000)
        tab.wait_for_function("!/STALE/.test(document.querySelector('#a11y-status').textContent)", timeout=30000)
    wait_until(lambda: "recovered" in github.alert_kinds(), 30, ("no recovered alert", github.alerts))
    assert server.get("/readyz")["checks"]["githubFresh"] is True

    # 7. A repository turning private is withdrawn from both browsers and the public API.
    github.set(BETA, private=True)
    assert server.webhook(BETA, "local-live-private") == 202
    for tab in (first, second):
        tab.wait_for_function("window.__AXP.diagnostics().totalLots === 1", timeout=30000)
        assert lot(tab, BETA) is None and lot(tab, ALPHA)["stars"] == 4321
    assert [p["lot"]["fullName"] for p in server.get("/api/city")["plan"]["placements"]] == [ALPHA]
    (SHOTS / "local-live.json").write_text(json.dumps(dict(alerts=github.alerts, status=server.get("/api/city/status")), indent=2))
    first.close()
    second.close()
