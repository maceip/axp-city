import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createWebhookServer, signBody, type WebhookServer } from "../src/webhooks/index.js";
import { parseLot } from "../src/parser/parseLot.js";
import { metrics } from "./helpers.js";

/**
 * Sustained load on the real HTTP server, durable queue and worker (handoff item 8,
 * finding G): a burst of concurrent, partly duplicated deliveries for hundreds of
 * repositories against a slow resolver, with stream subscribers attached throughout.
 */
const secret = "city-load-test";
const REPOS = 200;
const DELIVERIES_PER_REPO = 3; // one of which is an exact duplicate id

async function start(runtime: WebhookServer) {
  await runtime.city.load();
  await new Promise<void>((done) => runtime.server.listen(0, "127.0.0.1", done));
  const port = (runtime.server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}`;
}

async function stop(runtime: WebhookServer) {
  await runtime.stopWorker();
  runtime.server.closeAllConnections();
  await new Promise<void>((done) => runtime.server.close(() => done()));
  runtime.city.close();
}

async function subscriber(url: string) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body!.getReader();
  const counts = { snapshot: 0, mutation: 0, status: 0, other: 0 };
  let buffer = "";
  let ended = false;
  const pump = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += new TextDecoder().decode(chunk.value);
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event = frame.split("\n").find((l) => l.startsWith("event: "))?.slice(7);
          if (!frame.includes("data: ")) continue;
          if (event === "snapshot") counts.snapshot++;
          else if (event?.startsWith("lot_")) counts.mutation++;
          else if (event === "status") counts.status++;
          else counts.other++;
        }
      }
    } catch {
      /* aborted by close() */
    }
    ended = true;
  })();
  return {
    counts,
    get ended() {
      return ended;
    },
    close: async () => {
      controller.abort();
      await pump;
    },
  };
}

describe("sustained load", () => {
  it("accepts a concurrent duplicated burst for 200 repositories, drains it once each without drops or failures, and keeps subscribers connected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-load-"));
    let resolved = 0;
    const inflight = { now: 0, max: 0 };
    const runtime = createWebhookServer(
      {
        secret,
        adminToken: "admin",
        databasePath: join(dir, "city.sqlite"),
        coalesceMs: 0,
        rateLimitMax: 100_000,
        resolveRepository: async (fullName) => {
          inflight.now++;
          inflight.max = Math.max(inflight.max, inflight.now);
          await new Promise((r) => setTimeout(r, 5 + Math.random() * 10)); // a slow-ish GitHub
          inflight.now--;
          resolved++;
          const m = metrics({ fullName, stars: 1000 + resolved, isPrivate: false });
          return { lot: parseLot(m), metrics: m };
        },
      },
      0,
    );
    const base = await start(runtime);
    const names = Array.from({ length: REPOS }, (_, i) => `load/repo${i}`);
    await runtime.city.hydrate(names.map((fullName, i) => parseLot(metrics({ fullName, stars: i }))));
    const streams = await Promise.all([subscriber(`${base}/api/city/stream`), subscriber(`${base}/api/city/stream`)]);
    const heapBefore = process.memoryUsage().heapUsed;
    try {
      const post = (id: string, repo: string) => {
        const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: repo }, sender: { login: "human" } });
        return fetch(`${base}/webhooks/github`, {
          method: "POST",
          body,
          headers: { "x-github-event": "push", "x-github-delivery": id, "x-hub-signature-256": signBody(Buffer.from(body), secret) },
        });
      };
      // All deliveries at once: two distinct ids per repository plus one exact duplicate.
      const started = performance.now();
      const requests: Promise<Response>[] = [];
      for (const repo of names) {
        requests.push(post(`${repo}#1`, repo), post(`${repo}#2`, repo), post(`${repo}#1`, repo));
      }
      const responses = await Promise.all(requests);
      const acceptMs = performance.now() - started;
      const statuses = responses.map((r) => r.status);
      // Every authenticated delivery is acknowledged after it is persisted — never 5xx,
      // never rate-limited at this configured ceiling; the exact duplicate of an id already
      // stored is acknowledged with 200 and not stored again.
      expect(statuses.length).toBe(REPOS * DELIVERIES_PER_REPO);
      expect(statuses.filter((s) => s === 202).length).toBe(REPOS * 2);
      expect(statuses.filter((s) => s === 200).length).toBe(REPOS);
      const afterAccept = runtime.city.deliveryCounts();
      expect(afterAccept.pending + afterAccept.processing + afterAccept.done).toBe(REPOS * 2); // duplicates were not stored twice

      // The worker drains the whole backlog; each repository is refreshed exactly once for
      // its two deliveries (same repository, already coalesced by the queue) or at most twice.
      runtime.startWorker(10);
      const deadline = Date.now() + 60_000;
      for (;;) {
        const c = runtime.city.deliveryCounts();
        if (c.pending === 0 && c.processing === 0) break;
        expect(Date.now()).toBeLessThan(deadline);
        await new Promise((r) => setTimeout(r, 50));
      }
      const drainMs = performance.now() - started;
      const counts = runtime.city.deliveryCounts();
      expect(counts).toMatchObject({ pending: 0, processing: 0, failed: 0 });
      expect(counts.done).toBe(REPOS * 2);
      expect(resolved).toBeGreaterThanOrEqual(REPOS);
      expect(resolved).toBeLessThanOrEqual(REPOS * 2);
      // Every lot was refreshed from the resolver and persisted.
      const lots = runtime.city.lots();
      expect(lots.length).toBe(REPOS);
      expect(lots.every((lot) => lot.stars > 1000)).toBe(true);
      expect(runtime.city.database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });

      // Subscribers stayed attached through the burst and saw the changes.
      await new Promise((r) => setTimeout(r, 200));
      for (const s of streams) {
        expect(s.ended).toBe(false);
        expect(s.counts.snapshot).toBe(1);
        expect(s.counts.mutation).toBeGreaterThanOrEqual(REPOS);
      }
      const heapAfter = process.memoryUsage().heapUsed;
      // Delivery ids are not kept in memory: the heap after 600 deliveries is bounded.
      expect(heapAfter - heapBefore).toBeLessThan(64 * 2 ** 20);
      // Recorded for the performance notes; the test itself only bounds correctness.
      console.info(
        `[load] ${REPOS * DELIVERIES_PER_REPO} deliveries accepted in ${acceptMs.toFixed(0)} ms, drained in ${drainMs.toFixed(0)} ms, ` +
          `${resolved} resolver calls (max ${inflight.max} concurrent), heap +${((heapAfter - heapBefore) / 2 ** 20).toFixed(1)} MB`,
      );
    } finally {
      await Promise.all(streams.map((s) => s.close()));
      await stop(runtime);
    }
  }, 120_000);
});
