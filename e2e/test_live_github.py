"""Live GitHub through the real resolver, into two browsers.

Runs only with GITHUB_TOKEN (the `live_server` fixture skips otherwise). GitHub cannot
reach the test machine, so webhook *deliveries* are signed locally; every metric the
browsers show is fetched from api.github.com and checked against GitHub's own answer.
"""
import json
import os
import time
import urllib.request
from pathlib import Path

from conftest import ready

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)
REPO = os.environ.get("CITY_LIVE_REPO", "maceip/axp-city")


def github(path):
    request = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json", "User-Agent": "axp-city-e2e"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def lot(page):
    return page.evaluate("repo => window.__AXP.snapshot().plan.placements.find(p => p.lot.fullName.toLowerCase() === repo.toLowerCase())?.lot", REPO)


def diag(page):
    return page.evaluate("window.__AXP.diagnostics()")


def a11y_status(page):
    return page.locator("#a11y-status").inner_text()


def test_real_repository_reaches_two_browsers_and_an_outage_stays_visibly_stale(browser, live_server):
    server = live_server
    truth = github(f"/repos/{REPO}")
    first = browser.new_page(viewport=dict(width=1600, height=1000))
    second = browser.new_page(viewport=dict(width=1280, height=800))
    ready(first, server.url)
    ready(second, server.url)
    for tab in (first, second):
        state = diag(tab)
        assert state["mode"] == "live" and state["connection"] == "connected", state
        assert state["freshness"]["source"] == "github-token", state["freshness"]
        assert state["totalLots"] == 0
        assert "live city" in a11y_status(tab) and "fixture" not in a11y_status(tab).lower(), a11y_status(tab)

    # Enrollment is administrative; the resolver fetches from api.github.com.
    assert server.enroll(REPO) in (200, 201)
    for tab in (first, second):
        tab.wait_for_function("window.__AXP.diagnostics().totalLots === 1", timeout=60000)
        got = lot(tab)
        assert got["repoId"] == truth["id"], (got, truth["id"])
        assert got["stars"] == truth["stargazers_count"] and got["forks"] == truth["forks_count"], got
        assert got["dataSource"].startswith("github"), got["dataSource"]
        assert not got.get("partial"), got.get("partial")
        tab.wait_for_function("window.__AXP.diagnostics().freshness.lastSuccessfulRefreshAt")
        assert "GitHub refresh" in a11y_status(tab) and "STALE" not in a11y_status(tab), a11y_status(tab)
    fresh0 = diag(first)["freshness"]["lastSuccessfulRefreshAt"]
    first.evaluate("repo => window.__AXP.select(repo)", REPO)
    first.wait_for_function("window.__AXP.diagnostics().cardVisible")
    first.wait_for_timeout(800)
    first.screenshot(path=str(SHOTS / "live-github-two-browsers-a.png"))
    second.screenshot(path=str(SHOTS / "live-github-two-browsers-b.png"))

    # An authenticated push delivery re-fetches the repository from GitHub; both browsers
    # see the refresh time advance even when no metric changed (no fake "update").
    assert server.webhook(REPO, "live-1") == 202
    deadline = time.time() + 60
    while server.get("/api/city/status")["deliveries"]["done"] < 1:  # coalesced for up to 10 s, then fetched
        assert time.time() < deadline, server.get("/api/city/status")["deliveries"]
        time.sleep(0.5)
    for tab in (first, second):
        tab.wait_for_function("t => window.__AXP.diagnostics().freshness.lastSuccessfulRefreshAt > t", arg=fresh0, timeout=60000)
        assert lot(tab)["stars"] == truth["stargazers_count"]

    # A GitHub outage: the server restarts pointed at an unreachable API and refreshes
    # every 15 s. The browsers reconnect, keep the last good lot, and the status plate
    # reports the failure instead of presenting the data as fresh.
    server.extra_env.update(GITHUB_API_URL="http://127.0.0.1:9", CITY_STALE_AFTER_MS="20000")
    server.restart()
    for tab in (first, second):
        tab.wait_for_function("window.__AXP.diagnostics().connection === 'connected' && window.__AXP.diagnostics().totalLots === 1", timeout=60000)
        tab.wait_for_function("() => { const f = window.__AXP.diagnostics().freshness; return f.failingRepositories === 1 && Boolean(f.lastError); }", timeout=60000)
        tab.wait_for_function("/STALE|last error/.test(document.querySelector('#a11y-status').textContent)", timeout=60000)
        assert lot(tab)["stars"] == truth["stargazers_count"]
    status = server.get("/api/city/status")
    assert status["freshness"]["failingRepositories"] == 1 and status["freshness"]["lastError"], status["freshness"]
    first.screenshot(path=str(SHOTS / "live-github-outage-stale.png"))

    # GitHub is back: the next reconciliation pass recovers without any delivery.
    server.extra_env.pop("GITHUB_API_URL")
    server.restart()
    for tab in (first, second):
        tab.wait_for_function("window.__AXP.diagnostics().connection === 'connected'", timeout=60000)
        tab.wait_for_function("() => { const f = window.__AXP.diagnostics().freshness; return f.failingRepositories === 0 && f.lastSuccessfulRefreshAt && (!f.lastFailureAt || f.lastSuccessfulRefreshAt > f.lastFailureAt); }", timeout=60000)
        tab.wait_for_function("!/STALE|last error/.test(document.querySelector('#a11y-status').textContent)", timeout=60000)
    (SHOTS / "live-github.json").write_text(json.dumps(dict(repo=REPO, repoId=truth["id"], stars=truth["stargazers_count"], forks=truth["forks_count"], status=server.get("/api/city/status")), indent=2))
    first.close()
    second.close()
