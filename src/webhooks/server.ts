import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import {
  createCityStore,
  DEFAULT_STALE_AFTER_MS,
  type CityStore,
  type StoredDelivery,
} from "../live/cityStore.js";
import type { CityMutation, CityStatusEvent } from "../live/protocol.js";
import {
  refreshFailureKind,
  resolveRepository,
  type ResolvedRepository,
} from "../live/repository.js";
import { renderCitySvg } from "../export/svg.js";
import { repoName } from "../rules/load.js";
import type { RepoMetrics } from "../types.js";
import { authorizeAdmin, authorizeWebhook } from "./auth.js";
import { normalizeDelivery } from "./normalize.js";
import {
  clientAddress,
  createRateLimiter,
  LOOPBACK_PROXIES,
} from "./rateLimit.js";
import { WITHDRAWING_SIGNALS, type CityEvent, type DeliveryResult } from "./types.js";

export const MAX_BODY_BYTES = 1_000_000;
/** Backoff schedule for failed deliveries; after the last entry the delivery is marked failed. */
export const RETRY_SCHEDULE_MS: readonly number[] = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
];

export type LogLevel = "info" | "warn" | "error";
export type Logger = (
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
) => void;

export const consoleLogger: Logger = (level, message, context) => {
  const line = `[${level}] ${message}${context ? ` ${JSON.stringify(context)}` : ""}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export interface WebhookOptions {
  secret: string;
  /** Allow unsigned deliveries (local dev only — never in public). */
  allowUnsigned?: boolean;
  /** Flood protection for deliveries. Defaults: 120 per client per minute. */
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  /** Socket addresses whose X-Forwarded-For is trusted. Defaults to loopback (Caddy on the same host). */
  trustedProxies?: readonly string[];
  /** SQLite database path for city state, deliveries, and events. */
  databasePath?: string;
  /** @deprecated legacy JSON paths, imported once into the database. */
  cityMapPath?: string;
  logPath?: string;
  /** Bearer token for administrative lot changes. Empty denies all mutations. */
  adminToken?: string;
  /** Sprite PNG root, served at /assets/sprites/. */
  spritesRoot?: string;
  /** Verified custom artwork cache, served at /assets/artwork/. */
  artworkRoot?: string;
  clientRoot?: string;
  offline?: boolean;
  buildRevision?: string;
  staleAfterMs?: number;
  /** Deliveries for a repository refreshed this recently reuse the result. */
  coalesceMs?: number;
  /** Upper bound for one repository refresh, including GitHub calls. */
  refreshTimeoutMs?: number;
  resolveRepository?: (
    fullName: string,
    previous?: RepoMetrics,
  ) => Promise<ResolvedRepository>;
  frontend?: (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => void;
  log?: Logger;
  source?: "github-app" | "github-token" | "github-anonymous" | "fixture";
}

export interface RefreshResult {
  mutation: CityMutation | null;
  fullName: string;
}

export interface WebhookServer {
  server: Server;
  city: CityStore;
  port: number;
  /** Refresh one repository through the canonical resolver; throws on failure. */
  refreshRepository(fullName: string): Promise<RefreshResult>;
  /** Withdraw a lot's public data (admin removal, privatization, deletion). */
  withdrawRepository(fullName: string, reason: string): Promise<CityMutation | null>;
  /** Process queued deliveries until none are due. Resolves with the count processed. */
  drainDeliveries(now?: string): Promise<number>;
  startWorker(intervalMs?: number): void;
  stopWorker(): void;
  /** Broadcast a freshness/status update to stream subscribers. */
  publishStatus(): void;
  readonly effectiveConfig: EffectiveConfig;
}

export interface EffectiveConfig {
  rateLimitMax: number;
  rateLimitWindowMs: number;
  trustedProxies: string[];
  staleAfterMs: number;
  refreshTimeoutMs: number;
  coalesceMs: number;
  allowUnsigned: boolean;
  signed: boolean;
  adminEnabled: boolean;
  mode: "live" | "offline";
}

/**
 * Pure delivery handler: headers + raw body in, status + queued event out.
 * The delivery is durably queued before the response is written, so an
 * acknowledged delivery survives a crash. Kept free of HTTP so tests can drive
 * it without binding a port.
 */
export function handleDelivery(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  deliveryId: string | undefined,
  options: Pick<WebhookOptions, "secret" | "allowUnsigned">,
  city: Pick<CityStore, "enqueueDelivery" | "hasDelivery">,
): DeliveryResult {
  const signed = authorizeWebhook(
    rawBody,
    options.secret,
    headers["x-hub-signature-256"],
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
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return { status: 400, body: "invalid json" };

  const eventName = headers["x-github-event"];
  const name = Array.isArray(eventName) ? eventName[0] : (eventName ?? "");
  const receivedAt = new Date().toISOString();
  const event = normalizeDelivery(name, payload, deliveryId, receivedAt);
  if (!event) return { status: 200, body: "ignored" };
  try {
    repoName(event.repo);
  } catch {
    return { status: 400, body: "invalid repository" };
  }
  try {
    if (city.hasDelivery(event.id)) return { status: 200, body: "duplicate" };
    const queued = city.enqueueDelivery(event, true);
    return queued
      ? { status: 202, body: "queued", event }
      : { status: 200, body: "duplicate" };
  } catch {
    // Storage failed: the delivery was NOT recorded. GitHub does not retry on
    // its own; the operator redelivers from the App's delivery log.
    return { status: 500, body: "storage failure" };
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
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
      if (!rejected) resolveBody(Buffer.concat(chunks));
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
function statusPage(city: CityStore, mode: string): string {
  const rows = city
    .recentEvents(20)
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
  const counts = city.deliveryCounts();
  const fresh = city.freshness();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>AXP City status</title>
<style>body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.25rem .5rem;text-align:left}code{background:#f4f4f4;padding:.1rem .3rem}</style>
</head>
<body>
<h1>AXP City status</h1>
<p>Mode: <strong>${esc(mode)}</strong>. Lots: <strong>${city.lots().length}</strong>. Last successful GitHub refresh: <strong>${esc(fresh.lastSuccessfulRefreshAt ?? "never")}</strong>. Failing repositories: <strong>${fresh.failingRepositories}</strong>.</p>
<p>Deliveries — pending ${counts.pending}, processing ${counts.processing}, done ${counts.done}, failed ${counts.failed}, ignored ${counts.ignored}. Public events kept: ${city.eventCount()}.</p>
<table><thead><tr><th>Received</th><th>Repo</th><th>Signal</th><th>Actor</th><th>Detail</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">No events yet — configure a webhook.</td></tr>'}</tbody></table>
<h2>Endpoints</h2>
<ul>
<li><code>GET /city</code> — live shared map</li>
<li><code>GET /api/city</code> — canonical snapshot (placements, geometry, freshness)</li>
<li><code>GET /api/city/stream</code> — SSE: snapshot, lot mutations, status</li>
<li><code>GET /api/city/status</code> — freshness, delivery queue, effective configuration</li>
<li><code>GET /api/city/history?repo=owner/name</code> — lifecycle history of a published lot</li>
<li><code>GET /api/city/export.svg</code> — SVG rendering of the current plan</li>
<li><code>POST /webhooks/github</code> — GitHub deliveries (signed, queued)</li>
<li><code>GET /events?limit=50</code> — newest-first public event backlog</li>
<li><code>GET /events/stream</code> — live SSE feed of public events</li>
<li><code>GET /healthz</code> — liveness · <code>GET /readyz</code> — readiness</li>
</ul>
</body>
</html>
`;
}

function createBroadcaster<T>() {
  const clients = new Set<(event: T) => void>();
  return {
    add(send: (event: T) => void): () => void {
      clients.add(send);
      return () => {
        clients.delete(send);
      };
    },
    broadcast(event: T): void {
      for (const send of clients) {
        try {
          send(event);
        } catch {
          /* a broken subscriber never blocks others */
        }
      }
    },
    get size() {
      return clients.size;
    },
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

export function createWebhookServer(
  options: WebhookOptions,
  port: number,
): WebhookServer {
  const log = options.log ?? consoleLogger;
  const databasePath =
    options.databasePath ??
    join(
      options.cityMapPath
        ? join(options.cityMapPath, "..")
        : options.logPath
          ? join(options.logPath, "..")
          : "data",
      "city.sqlite",
    );
  const city = createCityStore(databasePath, {
    legacyMapPath: options.cityMapPath,
    legacyEventLogPath: options.logPath,
    staleAfterMs: options.staleAfterMs,
    source: options.source ?? (options.offline ? "fixture" : undefined),
    mode: options.offline ? "offline" : "live",
  });
  const events = createBroadcaster<CityEvent>();
  const status = createBroadcaster<CityStatusEvent>();
  const trustedProxies = [...(options.trustedProxies ?? LOOPBACK_PROXIES)];
  const rateLimitMax = options.rateLimitMax ?? 120;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
  const limiter = createRateLimiter({ max: rateLimitMax, windowMs: rateLimitWindowMs });
  const spritesRoot = options.spritesRoot ? resolve(options.spritesRoot) : "";
  const artworkRoot = options.artworkRoot ? resolve(options.artworkRoot) : "";
  const adminToken = options.adminToken ?? "";
  const mode = options.offline ? "offline" : "live";
  const refreshTimeoutMs = options.refreshTimeoutMs ?? 45_000;
  const coalesceMs = options.coalesceMs ?? 10_000;
  const resolveLot =
    options.resolveRepository ??
    ((fullName: string, previous?: RepoMetrics) =>
      resolveRepository(fullName, { previous }));
  const refreshes = new Map<string, Promise<RefreshResult>>();
  const lastRefreshAt = new Map<string, number>();

  const effectiveConfig: EffectiveConfig = {
    rateLimitMax,
    rateLimitWindowMs,
    trustedProxies,
    staleAfterMs: options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    refreshTimeoutMs,
    coalesceMs,
    allowUnsigned: options.allowUnsigned === true,
    signed: options.secret.length > 0,
    adminEnabled: adminToken.length > 0,
    mode,
  };

  let statusTimer: NodeJS.Timeout | undefined;
  function publishStatus(): void {
    // Coalesce bursts (a reconcile pass touches every lot) into one event.
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = undefined;
      status.broadcast({
        type: "status",
        serverTime: new Date().toISOString(),
        freshness: city.freshness(),
      });
    }, 250);
    statusTimer.unref?.();
  }

  async function performRefresh(fullName: string): Promise<RefreshResult> {
    const row = city.row(fullName);
    const at = new Date().toISOString();
    try {
      const resolved = await withTimeout(
        resolveLot(fullName, row?.metrics ?? undefined),
        refreshTimeoutMs,
        `refresh ${fullName}`,
      );
      const mutation = await city.ensure(
        fullName,
        resolved.lot,
        at,
        resolved.metrics,
      );
      city.recordRefresh({ fullName: resolved.lot.fullName, at, ok: true });
      lastRefreshAt.set(resolved.lot.fullName.toLowerCase(), Date.now());
      if (resolved.lot.fullName.toLowerCase() !== fullName.toLowerCase())
        lastRefreshAt.set(fullName.toLowerCase(), Date.now());
      return { mutation, fullName: resolved.lot.fullName };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = refreshFailureKind(error);
      city.recordRefresh({ fullName, at, ok: false, error: message });
      log(kind === "withdraw" ? "warn" : "error", `refresh ${fullName} failed`, {
        kind,
        error: message,
      });
      if (kind === "withdraw" && row) await city.withdraw(fullName, message);
      throw error;
    } finally {
      publishStatus();
    }
  }

  const refreshRepository = (fullName: string): Promise<RefreshResult> => {
    repoName(fullName);
    const key = fullName.toLowerCase();
    const previous = refreshes.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => performRefresh(fullName));
    refreshes.set(key, next);
    void next
      .finally(() => {
        if (refreshes.get(key) === next) refreshes.delete(key);
      })
      .catch(() => {});
    return next;
  };

  const withdrawRepository = async (fullName: string, reason: string) => {
    repoName(fullName);
    const mutation = await city.withdraw(fullName, reason);
    publishStatus();
    return mutation;
  };

  /** One queued delivery: lifecycle signal or refresh, then publish. */
  async function processDelivery(delivery: StoredDelivery): Promise<void> {
    const event = delivery.event;
    const now = new Date().toISOString();
    if (event.signal === "ping") {
      city.ignoreDelivery(delivery.id, now);
      return;
    }
    if (WITHDRAWING_SIGNALS.includes(event.signal)) {
      const target =
        city.row(event.repo) ??
        (event.previousRepo ? city.row(event.previousRepo) : undefined);
      if (target)
        await withdrawRepository(
          target.fullName,
          event.signal === "repo_removed"
            ? "repository deleted on GitHub"
            : "repository became private",
        );
      city.ignoreDelivery(delivery.id, now);
      return;
    }
    const known =
      city.row(event.repo) ??
      (event.previousRepo ? city.row(event.previousRepo) : undefined) ??
      (event.repoId != null
        ? city.rows().find((r) => r.repoId === event.repoId)
        : undefined);
    if (!known) {
      // Events for repositories that were never enrolled are recorded as
      // ignored; enrollment is an explicit administrative act.
      city.ignoreDelivery(delivery.id, now);
      return;
    }
    const recently = lastRefreshAt.get(event.repo.toLowerCase());
    let published = known.status === "published";
    if (!recently || Date.now() - recently > coalesceMs) {
      try {
        // A renamed repository is fetched under its new name; the store
        // matches it by repository id and keeps the address.
        const result = await refreshRepository(event.repo);
        published = city.row(result.fullName)?.status === "published";
      } catch (error) {
        const kind = refreshFailureKind(error);
        const message = error instanceof Error ? error.message : String(error);
        if (kind === "withdraw") {
          city.ignoreDelivery(delivery.id, now);
          return;
        }
        if (kind === "incomplete") {
          // The lot keeps its last good state; the event is still real.
          published = city.row(event.repo)?.status === "published";
        } else {
          const retryAt =
            delivery.attempts < RETRY_SCHEDULE_MS.length
              ? new Date(Date.now() + RETRY_SCHEDULE_MS[delivery.attempts]).toISOString()
              : null;
          city.failDelivery(delivery.id, message, retryAt);
          log("warn", `delivery ${delivery.id} failed`, {
            repo: event.repo,
            attempt: delivery.attempts + 1,
            retryAt,
            error: message,
          });
          publishStatus();
          return;
        }
      }
    }
    if (published) {
      const stored = city.appendEvent(event);
      if (stored) events.broadcast(event);
    }
    city.completeDelivery(delivery.id, new Date().toISOString());
  }

  let draining: Promise<number> | undefined;
  function drainDeliveries(now?: string): Promise<number> {
    if (draining) return draining;
    draining = (async () => {
      let processed = 0;
      for (;;) {
        const delivery = city.nextDelivery(now);
        if (!delivery) break;
        processed++;
        try {
          await processDelivery(delivery);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          city.failDelivery(
            delivery.id,
            message,
            delivery.attempts < RETRY_SCHEDULE_MS.length
              ? new Date(Date.now() + RETRY_SCHEDULE_MS[delivery.attempts]).toISOString()
              : null,
          );
          log("error", `delivery ${delivery.id} crashed`, { error: message });
        }
      }
      return processed;
    })().finally(() => {
      draining = undefined;
    });
    return draining;
  }

  let worker: NodeJS.Timeout | undefined;
  function startWorker(intervalMs = 15_000): void {
    if (worker) return;
    worker = setInterval(() => {
      void drainDeliveries().catch((error) =>
        log("error", "delivery worker failed", { error: String(error) }),
      );
    }, intervalMs);
    worker.unref?.();
    void drainDeliveries().catch(() => {});
  }
  function stopWorker(): void {
    if (worker) clearInterval(worker);
    worker = undefined;
  }

  function serveFile(
    res: ServerResponse,
    root: string,
    rel: string,
    types: Record<string, string>,
    cache = "public, max-age=31536000, immutable",
  ): boolean {
    const file = normalize(join(root, rel));
    if (!file.startsWith(`${root}/`) || !existsSync(file) || !statSync(file).isFile())
      return false;
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
    });
    createReadStream(file).pipe(res);
    return true;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (req.method === "POST" && path === "/webhooks/github") {
        const client = clientAddress(
          req.socket.remoteAddress,
          req.headers["x-forwarded-for"],
          trustedProxies,
        );
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
          text(res, 413, "body too large");
          return;
        }
        const result = handleDelivery(
          req.headers as Record<string, string | string[] | undefined>,
          raw,
          headerValue(req.headers["x-github-delivery"]),
          options,
          city,
        );
        text(res, result.status, result.body);
        if (result.event) {
          void drainDeliveries().catch((error) =>
            log("error", "delivery processing failed", { error: String(error) }),
          );
        }
        return;
      }
      if (req.method === "GET" && path === "/status") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(statusPage(city, mode));
        return;
      }
      if (req.method === "GET" && (path === "/api/city" || path === "/api/city/export.json")) {
        json(res, 200, city.snapshot(mode));
        return;
      }
      if (req.method === "GET" && path === "/api/city/export.svg") {
        const svg = renderCitySvg(city.snapshot(mode), {
          assetBase: `${url.searchParams.get("assets") ?? "/assets/sprites"}/`,
          detail: url.searchParams.get("detail") !== "0",
        });
        res.writeHead(200, {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(svg);
        return;
      }
      if (req.method === "GET" && path === "/api/city/status") {
        const freshness = city.freshness();
        const now = Date.now();
        const last = freshness.lastSuccessfulRefreshAt
          ? Date.parse(freshness.lastSuccessfulRefreshAt)
          : NaN;
        json(res, 200, {
          mode,
          buildRevision: options.buildRevision ?? "development",
          serverTime: new Date(now).toISOString(),
          freshness,
          stale:
            mode === "live" &&
            (Number.isNaN(last) || now - last > freshness.staleAfterMs),
          lots: city.lots().length,
          withdrawn: city.rows().filter((r) => r.status === "withdrawn").length,
          deliveries: city.deliveryCounts(),
          events: city.eventCount(),
          streamClients: status.size,
          config: effectiveConfig,
        });
        return;
      }
      if (req.method === "GET" && path === "/api/city/history") {
        const repo = url.searchParams.get("repo");
        if (!repo) {
          json(res, 400, { error: "repo query parameter required" });
          return;
        }
        const row = city.row(repo);
        // Withdrawn repositories are not public; their history is not either.
        if (!row || row.status !== "published") {
          json(res, 404, { error: "unknown repository" });
          return;
        }
        json(res, 200, {
          repo: row.fullName,
          addedAt: row.addedAt,
          slot: row.slot,
          history: city
            .history(row.fullName)
            .filter((entry) => entry.kind !== "withdrawn" || row.status === "published"),
        });
        return;
      }
      if (req.method === "GET" && path === "/api/city/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        let closed = false;
        const send = (type: string, id: number | null, event: unknown): void => {
          if (closed) return;
          if (res.writableLength > 1_000_000) {
            closed = true;
            res.destroy();
            return;
          }
          res.write(
            `${id === null ? "" : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        };
        const removeMutation = city.onMutation((event) =>
          send(event.type, event.revision, event),
        );
        const removeStatus = status.add((event) => send("status", null, event));
        const snapshot = city.snapshot(mode);
        send("snapshot", snapshot.revision, snapshot);
        const heartbeat = setInterval(() => {
          if (!closed) res.write(": heartbeat\n\n");
        }, 15_000);
        res.on("close", () => {
          closed = true;
          removeMutation();
          removeStatus();
          clearInterval(heartbeat);
        });
        return;
      }
      if (path === "/api/city/lots" || path.startsWith("/api/city/lots/")) {
        const auth = authorizeAdmin(
          req.headers as Record<string, string | string[] | undefined>,
          adminToken,
        );
        if (!auth.ok) {
          text(res, auth.status, auth.body);
          return;
        }
        if (req.method === "POST" && path === "/api/city/lots") {
          let raw: Buffer;
          try {
            raw = await readBody(req, 4096);
          } catch {
            text(res, 413, "body too large");
            return;
          }
          let repo = "";
          try {
            const body = JSON.parse(raw.toString("utf8")) as { repo?: string };
            repo = typeof body.repo === "string" ? body.repo.trim() : "";
          } catch {
            text(res, 400, "invalid json");
            return;
          }
          try {
            repoName(repo);
          } catch {
            text(res, 400, "invalid repo");
            return;
          }
          try {
            const result = await refreshRepository(repo);
            json(res, 200, result.mutation ?? { type: "exists", repo: result.fullName });
          } catch (error) {
            const kind = refreshFailureKind(error);
            const message = error instanceof Error ? error.message : String(error);
            log("warn", `admin enrollment of ${repo} failed`, { kind, error: message });
            json(res, kind === "withdraw" ? 422 : 502, {
              error:
                kind === "withdraw"
                  ? "repository is not public or not accessible"
                  : "repository could not be refreshed",
              detail: message,
            });
          }
          return;
        }
        if (req.method === "DELETE" && path.startsWith("/api/city/lots/")) {
          const repo = decodeURIComponent(path.slice("/api/city/lots/".length));
          try {
            repoName(repo);
          } catch {
            text(res, 400, "invalid repo");
            return;
          }
          const mutation = await withdrawRepository(repo, "removed by administrator");
          if (!mutation) {
            json(res, 404, { error: "unknown or already withdrawn repository" });
            return;
          }
          json(res, 200, mutation);
          return;
        }
        text(res, 405, "method not allowed");
        return;
      }
      if (
        spritesRoot &&
        req.method === "GET" &&
        (path === "/assets/sprites" || path.startsWith("/assets/sprites/"))
      ) {
        const rel = path.slice("/assets/sprites".length) || "/";
        if (
          serveFile(res, spritesRoot, rel, {
            ".png": "image/png",
            ".svg": "image/svg+xml",
          })
        )
          return;
        text(res, 404, "not found");
        return;
      }
      if (artworkRoot && req.method === "GET" && path.startsWith("/assets/artwork/")) {
        const rel = path.slice("/assets/artwork/".length);
        // Only verified, approved artwork is ever written to this directory.
        if (/^[0-9a-f]{64}\.png$/.test(rel) && serveFile(res, artworkRoot, rel, { ".png": "image/png" }))
          return;
        text(res, 404, "not found");
        return;
      }
      if (req.method === "GET" && path === "/events") {
        const limit = Math.min(
          200,
          Math.max(1, Number(url.searchParams.get("limit") ?? "50") || 50),
        );
        json(res, 200, city.recentEvents(limit));
        return;
      }
      if (req.method === "GET" && path === "/events/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        let closed = false;
        const send = (event: CityEvent): void => {
          if (closed) return;
          if (res.writableLength > 1_000_000) {
            closed = true;
            res.destroy();
            return;
          }
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const remove = events.add(send);
        res.on("close", () => {
          closed = true;
          remove();
        });
        return;
      }
      if (req.method === "GET" && path === "/healthz") {
        // Liveness only: the process answers. Readiness lives at /readyz.
        json(res, 200, {
          ok: true,
          renderer: "phaser-4",
          buildRevision: options.buildRevision ?? "development",
          lots: city.lots().length,
          mode,
        });
        return;
      }
      if (req.method === "GET" && path === "/readyz") {
        const clientReady = Boolean(
          options.frontend ||
            existsSync(resolve(options.clientRoot ?? "dist/game", "index.html")),
        );
        const writable = city.writable();
        const freshness = city.freshness();
        const last = freshness.lastSuccessfulRefreshAt
          ? Date.parse(freshness.lastSuccessfulRefreshAt)
          : NaN;
        const stale =
          mode === "live" &&
          city.lots().length > 0 &&
          (Number.isNaN(last) || Date.now() - last > freshness.staleAfterMs);
        const counts = city.deliveryCounts();
        const ready = clientReady && writable;
        json(res, ready ? 200 : 503, {
          ready,
          checks: {
            clientBundle: clientReady,
            storageWritable: writable,
            githubFresh: !stale,
            deliveryBacklog: counts.pending + counts.processing,
            failedDeliveries: counts.failed,
          },
          freshness,
          buildRevision: options.buildRevision ?? "development",
          mode,
        });
        return;
      }
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        !path.startsWith("/api/") &&
        !path.startsWith("/events")
      ) {
        if (options.frontend) {
          options.frontend(req, res, () => {
            res.writeHead(404);
            res.end("not found");
          });
          return;
        }
        const root = resolve(options.clientRoot ?? "dist/game");
        const name = ["/", "/city", "/city/", "/city.html", "/index.html"].includes(path)
          ? "index.html"
          : decodeURIComponent(path).replace(/^\//, "");
        const file = resolve(root, name);
        if (file.startsWith(`${root}/`) && existsSync(file) && statSync(file).isFile()) {
          const types: Record<string, string> = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".png": "image/png",
            ".webmanifest": "application/manifest+json",
          };
          res.writeHead(200, {
            "content-type": types[extname(file)] ?? "application/octet-stream",
            "cache-control": name.startsWith("assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
            "x-content-type-options": "nosniff",
          });
          if (req.method === "HEAD") res.end();
          else createReadStream(file).pipe(res);
          return;
        }
      }
      text(res, 404, "not found");
    } catch (error) {
      log("error", "request failed", {
        method: req.method,
        url: req.url,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) text(res, 500, "internal error");
      else res.destroy();
    }
  });

  return {
    server,
    city,
    port,
    refreshRepository,
    withdrawRepository,
    drainDeliveries,
    startWorker,
    stopWorker,
    publishStatus,
    effectiveConfig,
  };
}
