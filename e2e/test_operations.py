"""Operational contracts that need real server processes but no browser (handoff item 8):
a verified backup of the running store and a restore to another location."""
import json
import shutil
import subprocess
import time

from conftest import ADMIN, REPO, CityServer, fixture_metrics, keep_server_log, repo_metrics


def wait_for(predicate, timeout=20, what="condition"):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {what}")


def city_state(server):
    snapshot = server.get("/api/city")
    lots = {p["lot"]["fullName"]: (p["x"], p["y"], p["lot"].get("repoId"), p["addedAt"], p["lot"]["stars"]) for p in snapshot["plan"]["placements"]}
    history = {name: [(h["kind"], h["detail"]) for h in server.get(f"/api/city/history?repo={name}")["history"]] for name in lots}
    return snapshot["revision"], lots, history


def test_backup_of_the_running_store_restores_the_whole_city_elsewhere(server, tmp_path, request):
    # Give the store history worth keeping: a metric change, a rename, a delivery still queued.
    server.metrics[0]["stars"] = 31337
    server.metrics[7]["repoId"] = 9901
    server.save()
    assert server.webhook("acme/forge", "bk-1") == 202
    assert server.webhook("acme/annex", "bk-2") == 202
    wait_for(lambda: server.get("/api/city/status")["deliveries"]["done"] == 2, what="deliveries processed")
    server.metrics[7]["fullName"] = "acme/annex-renamed"
    server.metrics[7]["name"] = "annex-renamed"
    server.save()
    assert server.webhook_event("repository", dict(action="renamed", repository=dict(full_name="acme/annex-renamed", name="annex-renamed", id=9901, owner=dict(login="acme")), changes=dict(repository=dict(name={"from": "annex"}))), "bk-3") == 202
    wait_for(lambda: any(p["lot"]["fullName"] == "acme/annex-renamed" for p in server.get("/api/city")["plan"]["placements"]), what="rename published")
    revision, lots, history = city_state(server)
    assert lots["acme/forge"][4] == 31337 and history["acme/annex-renamed"][-1] == ("renamed", "from acme/annex")

    # 1. Verified backup while the server keeps running (VACUUM INTO + integrity_check + row counts).
    backup = tmp_path / "offsite" / "city.sqlite"
    result = subprocess.run(["node", "scripts/backup-city.mjs", str(server.root / "data"), str(backup)], cwd=REPO, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout.strip().splitlines()[-1])
    assert summary["integrity"] == "ok" and summary["lots"] == len(lots) and summary["deliveries"] == 3 and summary["bytes"] > 0
    assert backup.exists() and not (backup.parent / "city.sqlite-wal").exists()
    # The source is still live and unchanged by the backup.
    assert server.get("/readyz")["checks"]["storageWritable"] is True
    assert city_state(server) == (revision, lots, history)

    # 2. Restore to another location, following docs/DEPLOY.md: copy the backup in as city.sqlite, start, verify.
    elsewhere = tmp_path / "elsewhere"
    (elsewhere / "data").mkdir(parents=True)
    shutil.copy(backup, elsewhere / "data" / "city.sqlite")
    restored = CityServer(elsewhere, json.loads(json.dumps(server.metrics)))
    try:
        assert restored.get("/readyz")["ready"] is True
        assert city_state(restored) == (revision, lots, history), "restored city differs from the backup source"
        assert restored.get("/api/city/status")["deliveries"]["done"] == 3
        # Finished deliveries are remembered: a redelivery is a duplicate, not a re-run.
        assert restored.webhook("acme/forge", "bk-1") == 200
        # And the restored server carries on: new deliveries are persisted, processed and published.
        restored.metrics[0]["stars"] = 41414
        restored.save()
        assert restored.webhook("acme/forge", "bk-4") == 202
        wait_for(lambda: next(p["lot"]["stars"] for p in restored.get("/api/city")["plan"]["placements"] if p["lot"]["fullName"] == "acme/forge") == 41414, what="restored server publishing")
        _, after, _ = city_state(restored)
        assert {k: v[:4] for k, v in after.items()} == {k: v[:4] for k, v in lots.items()}, "addresses moved after the restore"
        # The original is untouched by what happened elsewhere.
        assert city_state(server) == (revision, lots, history)
    finally:
        restored.stop()
        keep_server_log(restored, request)


def test_backup_refuses_a_missing_or_corrupt_store(tmp_path):
    missing = subprocess.run(["node", "scripts/backup-city.mjs", str(tmp_path / "nowhere"), str(tmp_path / "out.sqlite")], cwd=REPO, capture_output=True, text=True)
    assert missing.returncode == 3 and not (tmp_path / "out.sqlite").exists()
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "city.sqlite").write_bytes(b"SQLite format 3\x00" + b"\x00" * 4000)
    corrupt = subprocess.run(["node", "scripts/backup-city.mjs", str(bad), str(tmp_path / "corrupt.sqlite")], cwd=REPO, capture_output=True, text=True)
    assert corrupt.returncode != 0 and not (tmp_path / "corrupt.sqlite").exists(), corrupt.stdout + corrupt.stderr
