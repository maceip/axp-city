# Authentication

The city page is a **public read**. Cameras are per-browser; the shared
secret is the map itself (lot addresses), not user sessions.

## GitHub webhooks (inbound)

`POST /webhooks/github` verifies `X-Hub-Signature-256` (HMAC-SHA256 of the
raw body) with `GITHUB_WEBHOOK_SECRET`. Comparison is timing-safe.

Unsigned deliveries are accepted **only** when the secret is empty **and**
the process was started with `--allow-unsigned`. A configured secret never
degrades to unsigned.

Missing/invalid signatures → `401 bad signature`. Floods → `429` before
the body is buffered. See [`WEBHOOKS.md`](WEBHOOKS.md).

## City mutations

`POST /api/city/lots` plots a repo by hand. It requires

```
Authorization: Bearer $CITY_ADMIN_TOKEN
```

The token is hashed then compared timing-safely. An empty/missing token
**denies** every mutation (fail closed). The page never receives this
token.

`GET /city`, `GET /api/city`, and `GET /api/city/stream` are public so
every visitor can share the same map.

## What we deliberately do not do

- No end-user login or OAuth on the map (no chat, no per-user state).
- No CORS wildcard on webhook POST.
- No leaking whether a secret is configured (401 either way).
