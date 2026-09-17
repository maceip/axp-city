# GitHub webhooks and live integration

## Where events come from

Immediate updates exist only for repositories whose owners granted event access: install the city's **GitHub App** on them, or add a repository webhook pointing at `https://demo.glint.sh/webhooks/github` (content type `application/json`, the same secret as the server's `GITHUB_WEBHOOK_SECRET`). Subscribe to push, pull request, issues, star, fork, and repository events. Pings are accepted.

Every other enrolled repository is refreshed by **reconciliation polling** (`CITY_REFRESH_INTERVAL_MS`, default 15 minutes, 250 ms between repositories). Polling also recovers changes whose deliveries never arrived. The city does not promise instant updates for arbitrary repositories.

`/api/city/status` and the HUD status plate show three separate things: the browser's **connection** to the stream, the **last successful GitHub refresh**, and **stale/error** state (`staleAfterMs`, default 45 minutes, plus the count of failing repositories — published lots whose last refresh failed; a refused enrollment or a withdrawn repository is answered to its caller and does not count). Connected does not mean fresh; a GitHub outage leaves the map visibly stale rather than pretending the data is current.

## Enrollment

A repository joins the city only through the canonical resolver: `POST /api/city/lots` with the admin bearer token, the `--enroll <file>` / `CITY_ENROLL_FILE` list at startup (an empty live city reads `repos.txt`), or the deploy's enrollment step. Deliveries for repositories that were never enrolled are recorded as `ignored`; a webhook cannot add a lot. Enrollment fetches metrics and rules, verifies the repository is public, assigns the next free address, and broadcasts `lot_added`.

## Delivery processing

1. **Authenticate** — HMAC-SHA256 of the raw body against `X-Hub-Signature-256` (timing-safe), body size ≤ 1 MB, proxy-aware rate limit, delivery id present, valid JSON, known repository name.
2. **Persist, then acknowledge** — the delivery is written to the SQLite `deliveries` table inside a transaction and the server answers `202 queued`. A repeated `X-GitHub-Delivery` answers `200 duplicate`. Storage failure answers `500 storage failure` and nothing is recorded.
3. **Process** — a worker drains due deliveries one at a time. A refresh reads absolute state from GitHub, so processing a delivery twice cannot double-count. Refreshes for one repository are serialized with admin and reconciliation refreshes. Bursts for one repository within `coalesceMs` (10 s) are deferred and become a single refresh at the end of the window; nothing is dropped. On shutdown the worker finishes the delivery in hand before the store closes; deliveries still queued are re-queued on the next start. If the process dies between claiming a delivery and finishing it (a crash while waiting on GitHub), the row is still `processing` on disk and is returned to `pending` when the store next opens, so the restarted process completes it; a late answer arriving in the dead process publishes nothing because the store is already closed (`test/live-city.test.ts`, "finishes a delivery interrupted…").
4. **Outcome** — success marks the delivery `done`, publishes `lot_updated` (or `lot_renamed` / `lot_added`) on `/api/city/stream`, and appends the public event. A repository that turned private, was deleted, or is inaccessible is **withdrawn**: its lot, history, and events leave every public path and the delivery is `ignored`. An incomplete GitHub response keeps the last good values (`partial`) and the event is still real.
5. **Storage failure** — a delivery the store cannot persist (disk full, permissions, corruption) is answered `500 storage failure` and is *not* recorded, so GitHub's delivery log shows it as failed for redelivery; nothing is half-published. A delivery already claimed when the disk fills either has its failure recorded (and retries on the normal schedule) or, if even that write is refused, stays `processing` and is re-queued at the start of the next drain in the same process — not only at restart. `test/live-city.test.ts` ("survives a full disk") fills a store with `PRAGMA max_page_count` and checks all of this together with `integrity_check`.
6. **Retry** — transport, rate-limit, or timeout failures schedule the delivery again after 30 s, 2 min, 10 min, 30 min, 2 h, 6 h; then it is `failed` and counted in `/readyz`. Retries happen from the local queue. **GitHub does not redeliver on its own**: a delivery GitHub never managed to hand over (server down for longer than its timeout, 5xx before persistence) has to be redelivered from the App's delivery log or it will be picked up by the next reconciliation pass.

Repository `renamed` / `transferred` events are matched by GitHub repository id and keep the lot's address. `deleted` and `privatized` events withdraw the lot. `publicized` (or a later admin enrollment) refreshes the withdrawn row and restores it at the same address; the history records `withdrawn` and `restored`.

## Retention and limits

Completed and ignored deliveries are pruned after 14 days; public events after 30 days (the newest 500 are always kept). Pruning runs with the 6-hourly housekeeping alongside verified backups (`CITY_BACKUP_DIR`). Both SSE feeds disconnect a subscriber whose socket buffer exceeds 1 MB so a stalled client cannot grow server memory. Rule files are limited to 64 KiB measured in bytes before parsing; custom artwork to 512 KiB.

## Diagnostics

- `GET /status` — human status page (mode, lots, freshness, queue counts, last 20 public events).
- `GET /api/city/status` — JSON: `freshness`, `stale`, lot and withdrawn counts, delivery counts by state, stream clients, effective configuration.
- `GET /events?limit=50`, `GET /events/stream` — public event backlog and feed (published lots only).
- `GET /healthz` — liveness. `GET /readyz` — readiness: client bundle, writable storage, GitHub freshness, delivery backlog, failed deliveries; 503 when the bundle or storage is missing. `checks.storageFailure` names the most recent write the store refused (`where`, `error`, `at`) that has not yet been followed by a successful write, and readiness is 503 while it is set: on a nearly full disk the one-row write probe (`storageWritable`) can still succeed while real deliveries are refused, so the probe alone is not trusted.

## Local production-shaped check

```sh
npm ci
npm run build
CITY_OFFLINE=1 npm start
```

Fixture mode is explicit, uses `data/offline/`, and is shown in the UI. Real webhook processing uses a signed request and the server-side resolver; the browser suite drives that same HTTP path with isolated recorded repositories and per-repository rule files under `<rulesDir>/repos/<owner>/<name>/`.
