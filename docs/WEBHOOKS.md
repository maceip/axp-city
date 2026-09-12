# Webhook catcher

Receives GitHub webhook deliveries, verifies them, and normalizes the ones
the city visualizes into `CityEvent`s. Those feed the live lot animations
(push → activity pulse, merged PR → crew celebration).

```
GitHub → POST /webhooks/github → verify HMAC → normalize → data/city-events.jsonl
                                                              ↓
                              city page ← GET /events?limit=50   ← backlog
                                        ← GET /events/stream    ← live (SSE)
```

No new dependencies — `node:http` + `node:crypto` only.

## Run

```bash
GITHUB_WEBHOOK_SECRET=<secret from GitHub> npm run webhooks
# → listening on 127.0.0.1:43174 → POST /webhooks/github
# --port 5000 to override; --host 0.0.0.0 only behind a reverse proxy;
# --allow-unsigned for local dev only (no secret)
```

The secret must match the webhook's secret token on GitHub exactly. It is
read from the environment so it never appears in process listings. Unsigned
deliveries get 401; `--allow-unsigned` only works when no secret is set, so
it cannot accidentally disable verification in public.

## GitHub setup

Repo webhook (per repo, needs admin) or a GitHub App (many repos, needs an
install per repo):

1. Payload URL: `https://<your-public-host>/webhooks/github`
2. Content type: `application/json`
3. Secret: generate with `openssl rand -hex 32`, store in `GITHUB_WEBHOOK_SECRET`
4. Subscribe to **push**, **pull_request**, **issues** (plus the automatic `ping`)
5. Save, then use GitHub's *Recent Deliveries → Redeliver* to test

Subscribed events the city uses:

| GitHub event | City signal | Lot effect |
| --- | --- | --- |
| `push` | `push` | activity pulse (crew appears if recent) |
| `pull_request` opened/reopened | `pr_opened` | materials arrive in the yard |
| `pull_request` closed + merged | `pr_merged` | crew celebration |
| `pull_request` closed, unmerged | `pr_closed` | materials leave |
| `issues` opened/reopened | `issue_opened` | blueprint appears |
| `issues` closed | `issue_closed` | blueprint leaves |

Everything else is acked `200 ignored` so GitHub does not retry it.

## Behavior

- `POST /webhooks/github` — verifies `X-Hub-Signature-256`, parses JSON
  (1 MB cap → 413), dedups on `X-GitHub-Delivery` (redelivery → `200
  duplicate`), appends to `data/city-events.jsonl` (gitignored runtime data).
- `GET /events?limit=50` — newest-first JSON backlog (max 200).
- `GET /events/stream` — SSE feed of new events for the live page.
- `GET /healthz` — `{ ok: true, stored: <seen delivery count> }`.

## Failure recovery

- **Restart-safe:** the CLI replays `data/city-events.jsonl` on boot
  (reported as `replayed N events`), rebuilding dedup state and the live
  buffer. Torn/corrupt lines are skipped and counted, never fatal.
- **Write-then-ack:** the log write happens *before* a delivery is marked
  seen. A storage failure answers `500 storage failure` with the id
  unmarked, so GitHub's retry still lands.
- **No exception leaks:** every handler is wrapped; the worst a caller ever
  sees is a status code plus a one-line body (`bad signature`, `invalid
  json`, `rate limited`, `storage failure`, `internal error`). Internal
  details never leave the process — they go to stderr.
- **Fatal faults exit:** `uncaughtException` / `unhandledRejection` log and
  exit non-zero so a supervisor (systemd, launchd, Docker) restarts a clean
  process, which replays the log and resumes. Run it supervised in public.

## Flood protection

- `POST /webhooks/github` is rate-limited per client IP: **120 deliveries
  per minute** by default, answered `429 rate limited` with a `Retry-After`
  header. The check runs before a single byte of body is buffered.
- Tune with `--rate-limit-max` / `--rate-limit-window-ms`.
- `GET /healthz` is never limited (load balancers stay happy).

Key files: `src/webhooks/verify.ts`, `src/webhooks/rateLimit.ts`,
`src/webhooks/normalize.ts`, `src/webhooks/store.ts`,
`src/webhooks/server.ts`, `src/cli/webhooks.ts`.
Tests: `test/webhooks.test.ts` (signature vectors, normalization table,
dedup, replay + corrupt lines, storage-failure retry, rate limits, and a
live HTTP round trip).

## Local dev without public hosting

Point a forwarder at the catcher and register *its* URL on GitHub, e.g.
`smee.io` or `cloudflared tunnel --url http://localhost:43174`. For
signature-free iteration: `npm run webhooks -- --allow-unsigned` (localhost only).
