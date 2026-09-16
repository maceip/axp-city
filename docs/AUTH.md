# Authentication and data boundaries

The Phaser application, city snapshot, SSE feeds, history, and exports are public reads of **published, public repositories only**. GitHub and admin credentials exist only on the server.

## Credentials

- **GitHub App** (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`): the recommended dedicated identity. The server signs a JWT with the private key and mints short-lived installation tokens (`src/ingest/githubApp.ts`); tokens are requested with `metadata: read, contents: read` only, cached in memory until five minutes before expiry, and never written anywhere. Grant the App read-only metadata/contents access to the repositories it should represent and subscribe it to the events in `WEBHOOKS.md`.
- **`GITHUB_TOKEN`**: an alternative dedicated fine-grained token with the same read-only scope. It must not be a personal login; `scripts/start-city.sh` no longer borrows the deployment user's `gh` CLI credential unless `CITY_ALLOW_GH_CLI_TOKEN=1` is set explicitly on a development host, and it warns when it does.
- **Anonymous**: without either, live refreshes still work under GitHub's unauthenticated rate limit and are labelled `github-anonymous` in `/api/city/status` and the HUD.

`/api/city/status` reports which credential kind is active (`freshness.source`), never the credential.

## Webhooks

`POST /webhooks/github` checks `X-Hub-Signature-256` against the raw request body with `GITHUB_WEBHOOK_SECRET`, using a timing-safe comparison. Missing configuration or invalid signatures return 401. A configured secret always requires a signature. `--allow-unsigned` is available only on a loopback development listener. Requests are size-limited (1 MB) and rate-limited before their bodies are buffered. The limiter identifies clients by `X-Forwarded-For` **only** when the socket address is one of `CITY_TRUSTED_PROXIES` (default loopback for Caddy); any other socket is identified by its own address, so a spoofed header cannot borrow another client's budget.

## Administration

`POST /api/city/lots` (`{ "repo": "owner/name" }`) and `DELETE /api/city/lots/owner/name` require `Authorization: Bearer $CITY_ADMIN_TOKEN`. An empty or missing token denies every mutation with 401. Enrollment goes through the same resolver as webhooks: it fetches real metrics and rules and refuses repositories that are private or inaccessible (422). The client has no admin form or embedded token. `scripts/deploy.sh` refuses to deploy unless `~/axp-city/env` (mode 600) defines `CITY_ADMIN_TOKEN` and `GITHUB_WEBHOOK_SECRET` plus App or token credentials.

## Public-data boundary

Before a lot is published or refreshed, the resolver checks `isPrivate` from GitHub. A repository that is private, becomes private, is deleted, or can no longer be read with the configured credential is **withdrawn**: `lots.status = 'withdrawn'`, and the row disappears from `/api/city`, `/api/city/export.json`, `/api/city/export.svg`, `/api/city/stream` (a `lot_removed` mutation is broadcast), `/api/city/history` (404), `/events`, and `/events/stream`. The address stays reserved so neighbours never move, and the lot is restored in place if the repository becomes public again. Unit tests (`test/live-city.test.ts`) and the browser suite exercise the transitions.

Credentials are loaded at service start from `~/axp-city/env` through systemd `EnvironmentFile`; they are not present in release archives, browser bundles, logs, or verification reports.
