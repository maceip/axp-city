# GitHub webhooks

Configure GitHub's webhook URL to `https://demo.glint.sh/webhooks/github`, content type `application/json`, and the same secret as the server's `GITHUB_WEBHOOK_SECRET`. Subscribe to push, pull request, issues, star, fork, and repository events. Pings are accepted and resolve the repository too.

The server validates HMAC-SHA256, repository identity, payload size, and delivery ID. On success it fetches current metrics and `.city/` rules, persists the lot, publishes JSON to connected Phaser clients, appends the diagnostic event, and returns 200. Repeated delivery IDs return `duplicate`. Upstream or storage failure returns 500 so GitHub can retry; the old lot remains available.

Read-only diagnostics are `/healthz`, `/status`, and `/events?limit=20`. `/api/city/stream` is the authoritative city feed, with a fresh snapshot on each connection; `/events/stream` is only the diagnostic event feed.

Local production-shaped check:

```sh
npm ci
npm run build
CITY_OFFLINE=1 npm start
```

The offline mode must be chosen explicitly and is shown in the UI. Real webhook processing uses a signed request and a server-side resolver; the browser suite supplies isolated recorded repositories through that same HTTP path.
