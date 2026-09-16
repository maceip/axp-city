# Shared city and live protocol

The Node process is authoritative for lots, their addresses, and their lifecycle. State lives in **SQLite** (`<CITY_DATA_DIR>/city.sqlite`, WAL, `synchronous=FULL`, `src/live/cityStore.ts`) with tables for lots, lot history, deliveries, public events, refresh status, and metadata. Every mutation is one transaction; the in-memory city and stream subscribers are updated only after the commit succeeds.

## Storage and layout versions

- `meta.schema_version` names the storage schema. A database with another schema is refused with an explicit error instead of being reinterpreted.
- `meta.layout_version` and `lots.layout_version` name the slot-assignment algorithm (`LAYOUT_VERSION` in `src/world/layout.ts`). Each lot stores its **explicit plot coordinates** (`col`, `row`, unique), so `planCity()` no longer recomputes addresses from order and constants. Changing the planner requires an explicit migration; the server refuses to open a store whose layout version differs rather than moving addresses implicitly.
- `meta.mode` records whether the store was created in `live` or `offline` (fixture) mode. Opening it in the other mode is refused, so fixture refreshes can never overwrite live GitHub state. Fixture mode defaults to `data/offline/`.
- On first start the store imports a legacy `city-map.json` (version 1 or 2) by reproducing the old `lotSlot(index)` assignment exactly, then renames the file aside (`city-map.json.imported-<time>`) and imports `city-events.jsonl` the same way. Old persisted data is tested across this upgrade in `test/city-store.test.ts`.
- Identity is the GitHub repository id (`lots.repo_id`) with the name as a fallback for rows imported before ids were known. Renames and transfers update the name, keep the address, and record `renamed`/`identity` history. Withdrawal keeps the row as a tombstone (`status = 'withdrawn'`) so the address stays reserved and neighbours never move; the row is restored in place if the repository becomes public again.

`src/world/planCity` maps stored coordinates to the plan. Park, river, freeway, tram, and plaza geometry is shared by server and client. The coordinate system is a 72×36 2:1 isometric tile square. Camera movement never changes the city.

## Reads

All reads return **published** lots only; withdrawn repositories are absent from every path.

- `GET /`, `/city`, `/city.html`: the same Phaser app.
- `GET /api/city` (= `/api/city/export.json`): `{ version: 1, schema: { snapshot, layout }, revision, serverTime, mode, plan, freshness, city, trending? }`. `city` is `{ name, kind }` — live hosting is **Trending City** (`kind: "trending"`). `plan.placements` contains each `CityLot`, its canonical `col`/`row` and world coordinates, district, optional `cadence` (`daily`/`weekly`/`monthly`), and construction timestamp; the plan also carries features, bounds, street rows, vacancies, and district `labels`. `freshness` reports the last successful GitHub refresh. `trending` reports the last trending-list fetch (live, last-good cache, or an explicit test fixture) and never silently substitutes recorded city fixtures.
- `GET /api/city/export.svg?detail=1`: SVG of the same plan (see `README.md` § Exports).
- `GET /api/city/history?repo=owner/name`: `addedAt`, slot, and lifecycle history (`added`, `renamed`, `identity`, `withdrawn`, `restored`) for a published lot; 404 otherwise.
- `GET /api/city/status`: freshness, `stale`, counts, delivery queue by state, stream clients, effective configuration.
- `GET /api/city/stream`: SSE. Every connection, including a reconnect with `Last-Event-ID`, starts with a full `snapshot`. Following events are revisioned mutations — `lot_added` (with updated `geometry`), `lot_updated`, `lot_renamed` (`previousFullName`), `lot_removed` (`fullName`, `reason`, `geometry`) — plus unrevisioned `status` events carrying `freshness`. Events contain no markup.
- `GET /healthz` (liveness), `GET /readyz` (readiness), `GET /status`, `/events`, `/events/stream`: diagnostics (see `WEBHOOKS.md`).

The client (`game/src/connection.ts`) validates the snapshot shape, refuses a snapshot whose `schema.snapshot` is newer than it understands (asking for a reload), ignores old or duplicate revisions, and drops the stream to take a fresh snapshot when it sees a revision gap. A snapshot and subscription are established synchronously in one server event-loop turn. Heartbeats keep the connection alive; subscribers whose socket buffer exceeds 1 MB are disconnected so they resynchronize. The HUD shows connection state, last refresh, and stale state as three separate indicators.

## Updates

`POST /webhooks/github` and `POST /api/city/lots` are the only writers; both go through the canonical resolver (`src/live/repository.ts`): fetch metrics under the configured credential, verify the repository is public, read and validate `.city/` rules, attach approved artwork, parse the lot, then `ensure()` it in one transaction. Refreshes are absolute reads, so repeating one is harmless. Refreshes for the same repository are serialized across webhooks, admin calls, and scheduled reconciliation.

A refresh whose metrics did not change (same lot signature after the freshness fields are excluded) records the refresh time without committing a new revision or broadcasting a mutation, so freshness-only polling does not churn clients or rebuild lot sprites.

Construction is a pure function of the server's `addedAt` and server time: grading → framing → cladding → finishing over 45 s (`CONSTRUCTION_MS`), identical for every visitor and after a reload. Cameras, selection, follow state, weather, and ambient traffic/pedestrians are local to each browser. **Shared:** the map, lots, rules, construction timestamps, and freshness. **Not shared:** actor positions, weather, camera. Two visitors see the same city, not the same traffic.

This is a single-process persisted city. Run one writer against its data directory; horizontal multi-writer deployment would require a shared transactional store and fanout, which are not implemented.
