# Authentication

The Phaser application, city snapshot, and SSE feeds are public reads. GitHub and admin credentials exist only on the server.

`POST /webhooks/github` checks `X-Hub-Signature-256` against the raw request body with `GITHUB_WEBHOOK_SECRET`, using a timing-safe comparison. Missing configuration or invalid signatures return 401. A configured secret always requires a signature. Explicit `--allow-unsigned` is available only on a loopback development listener. Requests are size-limited and rate-limited before their bodies are buffered.

`POST /api/city/lots` requires `Authorization: Bearer $CITY_ADMIN_TOKEN`. An empty/missing token denies mutations. The client has no admin form or embedded token.

`GITHUB_TOKEN` provides server-side read access to GitHub metrics and rule files and enables periodic reconciliation. Use a token with only the access needed for the repositories represented in the public city. Do not expose private-repository metadata in this public map unless that is intended.

The deployment can reuse an existing authenticated GitHub CLI credential on the same server. Credentials are loaded at service start without being written to release artifacts or browser bundles.
