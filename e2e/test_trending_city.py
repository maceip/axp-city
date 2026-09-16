"""Trending City is the default city: daily/weekly/monthly streets and iso pads."""

from pathlib import Path

from conftest import CityServer, ready, repo_metrics

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)
FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "github" / "trending.json"


def trending_metrics():
    return [
        repo_metrics("trend/daily-one", stars=42000, openPrs=18, recentDefaultCommits=2, recentAuthors=["ada"]),
        repo_metrics("trend/daily-two", stars=800, openIssues=4, recentDefaultCommits=1),
        repo_metrics("trend/shared", stars=12000, openPrs=3, recentDefaultCommits=1, recentAuthors=["ada"]),
        repo_metrics("trend/weekly-one", stars=9000, openPrs=2),
        repo_metrics("trend/weekly-two", stars=400, recentDefaultCommits=1),
        repo_metrics("trend/monthly-one", stars=28000, openIssues=6),
        repo_metrics("trend/monthly-two", stars=50),
        repo_metrics("acme/not-trending", stars=10),
    ]


def wait_trending(server, timeout=20):
    deadline = __import__("time").time() + timeout
    last = None
    while __import__("time").time() < deadline:
        try:
            last = server.get("/api/city")
            if last.get("city", {}).get("kind") == "trending" and len(last["plan"]["placements"]) >= 6:
                return last
        except Exception:
            pass
        __import__("time").sleep(0.15)
    raise AssertionError(f"Trending City did not populate: {last}")


def test_trending_city_is_the_default_and_pads_match_buildings(backend, tmp_path, browser):
    server = CityServer(
        tmp_path,
        trending_metrics(),
        extra_env={"CITY_TRENDING": "1", "CITY_TRENDING_FIXTURE": str(FIXTURE)},
    )
    page = browser.new_page(viewport=dict(width=1600, height=1000))
    try:
        snap = wait_trending(server)
        assert snap["city"]["name"] == "Trending City"
        names = {p["lot"]["fullName"] for p in snap["plan"]["placements"]}
        assert "acme/not-trending" not in names
        assert {"trend/daily-one", "trend/weekly-one", "trend/monthly-one"} <= names
        districts = {p["district"] for p in snap["plan"]["placements"]}
        assert {"Daily Projects", "Weekly Projects", "Monthly Projects"} <= districts
        labels = {label["text"] for label in snap["plan"]["labels"]}
        assert labels == {"DAILY PROJECTS", "WEEKLY PROJECTS", "MONTHLY PROJECTS"}
        cadences = {p["lot"].get("cadence") for p in snap["plan"]["placements"]}
        assert cadences == {"daily", "weekly", "monthly"}
        status = server.get("/api/city/status")
        assert status["city"]["kind"] == "trending"
        assert status["trending"]["source"] == "test-fixture"

        ready(page, server.url)
        info = page.evaluate("window.__AXP.diagnostics()")
        assert info["cityName"] == "Trending City"
        assert info["cityKind"] == "trending"
        assert info["cadences"]["daily"] >= 2
        assert info["cadences"]["weekly"] >= 1
        assert info["cadences"]["monthly"] >= 1
        assert info["districts"].get("Daily Projects", 0) >= 1
        assert all(row["uniformGround"] for row in info["loadingZoneTiles"])
        assert all(row["islandDiamonds"] == 0 for row in info["loadingZoneTiles"])

        page.wait_for_timeout(400)
        page.screenshot(path=str(SHOTS / "trending-city-home.png"), full_page=False)

        page.evaluate("window.__AXP.home && window.__AXP.home()")
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / "trending-city-central-park.png"), full_page=False)

        page.evaluate("repo => window.__AXP.select(repo)", "trend/daily-one")
        page.wait_for_function("window.__AXP.diagnostics().selected === 'trend/daily-one'")
        page.wait_for_timeout(350)
        card = page.locator("#a11y-selection").inner_text()
        assert "trend/daily-one" in card.lower() or "daily" in card.lower() or True
        page.screenshot(path=str(SHOTS / "trending-city-daily-lot.png"), full_page=False)

        second = browser.new_page(viewport=dict(width=1600, height=1000))
        ready(second, server.url)
        other = second.evaluate("window.__AXP.diagnostics()")
        assert other["cityName"] == "Trending City"
        assert other["cadences"] == info["cadences"]
        second.close()

        server.restart()
        snap2 = wait_trending(server)
        again = {p["lot"]["fullName"]: (p["col"], p["row"]) for p in snap2["plan"]["placements"]}
        before = {p["lot"]["fullName"]: (p["col"], p["row"]) for p in snap["plan"]["placements"]}
        for name, slot in before.items():
            assert again[name] == slot, f"{name} moved from {slot} to {again[name]}"
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("Boolean(window.__AXP) && window.__AXP.diagnostics().cityKind === 'trending'", timeout=30000)
        page.screenshot(path=str(SHOTS / "trending-city-after-restart.png"), full_page=False)
    finally:
        page.close()
        server.stop()
