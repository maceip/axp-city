import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createCityStore, type CityStore } from "../live/cityStore.js";
import { renderCityHtml } from "../render/html.js";
import { planSnapshot } from "../render/city.js";
import { planCity } from "../world/layout.js";
import { authorizeAdmin, authorizeWebhook } from "./auth.js";
import { normalizeDelivery } from "./normalize.js";
import { createRateLimiter } from "./rateLimit.js";
import { createEventStore, type EventStore } from "./store.js";
import type { CityEvent, DeliveryResult } from "./types.js";

export const MAX_BODY_BYTES = 1_000_000;

export interface WebhookOptions {
  secret: string;
  /** Allow unsigned deliveries (local dev only — never in public). */
  allowUnsigned?: boolean;
  logPath?: string;
  /** Flood protection for deliveries. Defaults: 120 per IP per minute. */
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  /** Shared city map persistence. Defaults next to the event log. */
  cityMapPath?: string;
  /** Bearer token for POST /api/city/lots. Empty denies all mutations. */
  adminToken?: string;
  /** Sprite PNG root, served at /assets/sprites/. */
  spritesRoot?: string;
}

export interface WebhookServer {
  server: Server;
  store: EventStore;
  city: CityStore;
  port: number;
}

/**
 * Pure delivery handler: headers + raw body in, status + optional city event
 * out. Kept free of HTTP so tests can drive it without binding a port.
 */
export async function handleDelivery(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  deliveryId: string | undefined,
  options: WebhookOptions,
  store: EventStore,
): Promise<DeliveryResult> {
  const secret = options.secret;
  const signature = headers["x-hub-signature-256"];
  const signed = authorizeWebhook(
    rawBody,
    secret,
    signature,
    options.allowUnsigned === true,
  );
  if (!signed.ok) return { status: 401, body: signed.body };
  if (!deliveryId) return { status: 400, body: "missing delivery id" };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    return { status: 400, body: "invalid json" };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: 400, body: "invalid json" };
  }

  const eventName = headers["x-github-event"];
  const name = Array.isArray(eventName) ? eventName[0] : (eventName ?? "");
  const receivedAt = new Date().toISOString();
  const event = normalizeDelivery(name, payload, deliveryId, receivedAt);
  if (!event) return { status: 200, body: "ignored" };
  try {
    const stored = await store.append(event);
    return stored
      ? { status: 200, body: "ok", event }
      : { status: 200, body: "duplicate" };
  } catch {
    // Storage failed: the delivery was NOT marked seen, so GitHub's retry
    // still lands. Never leak the I/O error to the caller.
    return { status: 500, body: "storage failure" };
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/** Escape untrusted webhook content (repo names, actors, titles) for HTML. */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** Human status page for bare-domain visits. Server-rendered, auto-refresh. */
function statusPage(store: EventStore): string {
  const rows = store
    .recent(20)
    .map((event) => {
      const detail = [event.number ? `#${event.number}` : "", event.title ?? ""]
        .filter(Boolean)
        .join(" ");
      return (
        `<tr><td>${esc(event.receivedAt)}</td>` +
        `<td>${esc(event.repo)}</td>` +
        `<td>${esc(event.signal)}</td>` +
        `<td>${esc(event.actor ?? "—")}</td>` +
        `<td>${esc(detail || "—")}</td></tr>`
      );
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>AXP City webhook catcher</title>
<style>body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.25rem .5rem;text-align:left}code{background:#f4f4f4;padding:.1rem .3rem}</style>
</head>
<body>
<h1>AXP City webhook catcher</h1>
<p>Deliveries seen: <strong>${store.size}</strong>. Latest events below, refreshes every 10 seconds.</p>
<table><thead><tr><th>Received</th><th>Repo</th><th>Signal</th><th>Actor</th><th>Detail</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">No events yet — configure a webhook.</td></tr>'}</tbody></table>
<h2>Endpoints</h2>
<ul>
<li><code>GET /city</code> — live shared map</li>
<li><code>GET /api/city</code> — canonical lot placements</li>
<li><code>GET /api/city/stream</code> — SSE for new plots</li>
<li><code>POST /webhooks/github</code> — GitHub deliveries (signed)</li>
<li><code>GET /events?limit=50</code> — newest-first JSON backlog</li>
<li><code>GET /events/stream</code> — live SSE feed</li>
<li><code>GET /healthz</code> — health check</li>
</ul>
</body>
</html>
`;
}

/** SSE subscribers for the live city page. */
function createBroadcaster() {
  const clients = new Set<(event: CityEvent) => void>();
  return {
    add(send: (event: CityEvent) => void): () => void {
      clients.add(send);
      return () => {
        clients.delete(send);
      };
    },
    broadcast(event: CityEvent): void {
      for (const send of clients) send(event);
    },
  };
}

export function createWebhookServer(
  options: WebhookOptions,
  port: number,
): WebhookServer {
  const logPath = options.logPath ?? "data/city-events.jsonl";
  const store = createEventStore(logPath);
  const city = createCityStore(options.cityMapPath ?? join(logPath, "..", "city-map.json"));
  const broadcast = createBroadcaster();
  const limiter = createRateLimiter({
    max: options.rateLimitMax ?? 120,
    windowMs: options.rateLimitWindowMs ?? 60_000,
  });
  const spritesRoot = options.spritesRoot ? resolve(options.spritesRoot) : "";
  const adminToken = options.adminToken ?? "";

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "POST" && url.pathname === "/webhooks/github") {
        const client = req.socket.remoteAddress ?? "unknown";
        const decision = limiter.check(client);
        if (!decision.allowed) {
          res.writeHead(429, {
            "content-type": "text/plain",
            "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)),
          });
          res.end("rate limited");
          return;
        }
        let raw: Buffer;
        try {
          raw = await readBody(req, MAX_BODY_BYTES);
        } catch {
          res.writeHead(413, { "content-type": "text/plain" });
          res.end("body too large");
          return;
        }
        const result = await handleDelivery(
          req.headers as Record<string, string | string[] | undefined>,
          raw,
          headerValue(req.headers["x-github-delivery"]),
          options,
          store,
        );
        if (result.event) {
          broadcast.broadcast(result.event);
          await city.ensure(result.event.repo);
        }
        res.writeHead(result.status, { "content-type": "text/plain" });
        res.end(result.body);
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(statusPage(store));
        return;
      }
      if (req.method === "GET" && (url.pathname === "/city" || url.pathname === "/city.html")) {
        const html = renderCityHtml(city.lots(), new Date().toISOString(), {
          addedAt: city.addedAt(),
        });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/city") {
        const plan = planCity(city.lots(), { addedAt: city.addedAt() });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(planSnapshot(plan)));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/city/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        const send = (event: unknown): void => {
          const typed = event as { type?: string };
          res.write(`event: ${typed.type ?? "message"}\n`);
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const remove = city.onMutation(send);
        req.on("close", remove);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/city/lots") {
        const auth = authorizeAdmin(
          req.headers as Record<string, string | string[] | undefined>,
          adminToken,
        );
        if (!auth.ok) {
          res.writeHead(auth.status, { "content-type": "text/plain" });
          res.end(auth.body);
          return;
        }
        let raw: Buffer;
        try {
          raw = await readBody(req, 4096);
        } catch {
          res.writeHead(413, { "content-type": "text/plain" });
          res.end("body too large");
          return;
        }
        let repo = "";
        try {
          const body = JSON.parse(raw.toString("utf8")) as { repo?: string };
          repo = typeof body.repo === "string" ? body.repo.trim() : "";
        } catch {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("invalid json");
          return;
        }
        if (!/^[^/]+\/[^/]+$/.test(repo)) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("invalid repo");
          return;
        }
        const mutation = await city.ensure(repo);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(mutation ?? { type: "exists", repo }));
        return;
      }
      if (
        spritesRoot &&
        req.method === "GET" &&
        (url.pathname === "/assets/sprites" || url.pathname.startsWith("/assets/sprites/"))
      ) {
        const rel = url.pathname.slice("/assets/sprites".length) || "/";
        const file = normalize(join(spritesRoot, rel));
        if (!file.startsWith(spritesRoot) || !existsSync(file) || !statSync(file).isFile()) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        const types: Record<string, string> = {
          ".png": "image/png",
          ".svg": "image/svg+xml",
        };
        res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
        createReadStream(file).pipe(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/events") {
        const limit = Math.min(
          200,
          Math.max(1, Number(url.searchParams.get("limit") ?? "50") || 50),
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(store.recent(limit)));
        return;
      }
      if (req.method === "GET" && url.pathname === "/events/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        const send = (event: CityEvent): void => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const remove = broadcast.add(send);
        req.on("close", remove);
        return;
      }
      if (req.method === "GET" && url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, stored: store.size, lots: city.lots().length }));
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("internal error");
      } else {
        res.destroy();
      }
    }
  });

  return { server, store, city, port };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
