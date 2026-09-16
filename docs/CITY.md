# Shared city and live protocol

The Node process is authoritative for lots and their order. `data/city-map.json` stores version 2 state: `revision`, append-only `order`, `lots`, and original `addedAt` timestamps. Version 1 maps migrate without changing order or addresses. Each update writes and syncs a temporary file, renames it atomically, and only then publishes the new state. Persist failures do not mutate the in-memory city.

`src/world/planCity` maps that stable order to unreserved ring slots around Central Park. Park, river, freeway, tram, and plaza geometry is shared by server and client. The coordinate system is a 72×36 2:1 isometric tile square. Camera movement never changes the city.

## Reads

- `GET /`, `/city`, `/city.html`: the same Phaser app.
- `GET /api/city`: `{ version: 1, revision, serverTime, mode, plan }`. `plan.placements` contains each complete `CityLot`, canonical coordinates, district, and construction timestamp. The plan also includes features, bounds, street rows, and vacancies.
- `GET /api/city/stream`: SSE. Every connection, including a reconnect with `Last-Event-ID`, starts with a full `snapshot` of current state. Following `lot_added` / `lot_updated` events carry `{ type, revision, serverTime, placement }`; additions also carry updated `geometry`. Events contain no markup.
- `GET /healthz`: renderer, build commit, mode, and state counts.
- `GET /status`, `/events`, `/events/stream`: webhook diagnostics.

A client ignores old/duplicate revisions and reconnects for a fresh snapshot if there is a revision gap. A snapshot and subscription are established synchronously in one server event-loop turn. Heartbeats keep the SSE connection alive; stalled subscribers are disconnected so they can resynchronize. Reconnect and restart tests exercise this behavior with two real browser contexts.

## Updates

`POST /webhooks/github` verifies the signature before processing. Pushes, PR/issue changes, stars, forks, and repository creation refresh metrics and rules from GitHub. These are absolute state reads, so retrying a failed delivery does not double-increment counts. Refreshes for the same repository are serialized, including manual updates and scheduled reconciliation. The delivery is acknowledged only after city persistence and event-log append succeed. Duplicate acknowledged delivery IDs are ignored.

`POST /api/city/lots` with an admin bearer token and `{ "repo": "owner/name" }` fetches and adds or refreshes a real repository. It cannot insert arbitrary client-provided metrics or empty placeholder lots.

The browser derives construction progress from `addedAt` and server time; construction ends after 45 seconds, even after a reload. Cameras and selected lots stay local to each visitor. There is no chat or synchronized camera.

This is a single-process persisted city. Run one writer against its data directory; horizontal multi-writer deployment would require a transactional shared store and fanout, which are not implemented here.
