import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createWebhookServer, signBody, type WebhookServer } from "../src/webhooks/index.js";
import { createCityStore } from "../src/live/cityStore.js";
import { RepositoryUnavailableError } from "../src/ingest/github.js";
import { IncompleteRefreshError } from "../src/ingest/merge.js";
import { parseLot } from "../src/parser/parseLot.js";
import { loadRepositoryRules } from "../src/rules/load.js";
import { DEFAULT_RULES } from "../src/rules/cityFiles.js";
import { metrics } from "./helpers.js";
import type { RepoMetrics } from "../src/types.js";

const secret = "city-integration-test";

async function streamReader(url: string) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body!.getReader();
  let buffer = "";
  return {
    close: () => controller.abort(),
    async next(): Promise<{ event: string; data: any }> {
      for (;;) {
        while (!buffer.includes("\n\n")) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("stream ended");
          buffer += new TextDecoder().decode(chunk.value);
        }
        const index = buffer.indexOf("\n\n");
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const lines = frame.split("\n");
        const data = lines.find((line) => line.startsWith("data: "));
        if (!data) continue; // heartbeat
        return {
          event: lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "message",
          data: JSON.parse(data.slice(6)),
        };
      }
    },
    async until(type: string) {
      for (;;) {
        const frame = await this.next();
        if (frame.event === type) return frame.data;
      }
    },
  };
}

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

describe("live city contract", () => {
  it("applies signed changes to real lots, broadcasts JSON, deduplicates and retries deliveries, and resynchronizes after reconnect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-live-"));
    let stars = 26000;
    let fail = false;
    let calls = 0;
    const runtime = createWebhookServer(
      {
        secret,
        adminToken: "admin",
        databasePath: join(dir, "city.sqlite"),
        coalesceMs: 0,
        resolveRepository: async (fullName) => {
          calls++;
          if (fail) throw new Error("upstream unavailable");
          const m = metrics({
            fullName,
            stars,
            openPrs: 8,
            openIssues: 5,
            recentDefaultCommits: 2,
            isPrivate: false,
          });
          return { lot: parseLot(m), metrics: m };
        },
      },
      0,
    );
    const base = await start(runtime);
    await runtime.city.hydrate([parseLot(metrics({ fullName: "acme/widget", stars: 100 }))]);
    const post = async (id: string, repo = "acme/widget", signed = true) => {
      const body = JSON.stringify({
        ref: "refs/heads/main",
        repository: { full_name: repo },
        sender: { login: "human" },
      });
      return fetch(`${base}/webhooks/github`, {
        method: "POST",
        body,
        headers: {
          "x-github-event": "push",
          "x-github-delivery": id,
          "x-hub-signature-256": signed ? signBody(Buffer.from(body), secret) : "bad",
        },
      });
    };
    const stream = await streamReader(`${base}/api/city/stream`);
    try {
      const initial = await stream.until("snapshot");
      expect(initial.schema).toEqual({ snapshot: 2, layout: 1 });
      expect(initial.freshness).toMatchObject({ lastSuccessfulRefreshAt: null });
      const first = initial.plan.placements[0];
      expect((await post("bad", "acme/widget", false)).status).toBe(401);
      expect(calls).toBe(0);
      expect(
        (
          await fetch(`${base}/api/city/lots`, {
            method: "POST",
            body: JSON.stringify({ repo: "acme/new" }),
          })
        ).status,
      ).toBe(401);
      expect((await post("update-1")).status).toBe(202);
      const event = await stream.until("lot_updated");
      expect(event).not.toHaveProperty("svg");
      expect(event.placement.lot).toMatchObject({
        stars: 26000,
        openPrs: 8,
        openIssues: 5,
        buildingBand: "L",
        showMaterials: true,
        showCrew: true,
      });
      expect([event.placement.x, event.placement.y]).toEqual([first.x, first.y]);
      const status = await stream.until("status");
      expect(status.freshness.lastSuccessfulRefreshAt).not.toBeNull();
      const duplicates = await Promise.all([post("update-1"), post("update-1")]);
      expect(await duplicates[0].text()).toBe("duplicate");
      expect(calls).toBe(1);

      // Upstream failure: the delivery is acknowledged, kept, and retried later;
      // the lot keeps its last good state and freshness reports the error.
      fail = true;
      expect((await post("retry")).status).toBe(202);
      await runtime.drainDeliveries();
      expect(runtime.city.deliveryCounts()).toMatchObject({ pending: 1, done: 1 });
      expect(runtime.city.lots()[0].stars).toBe(26000);
      const failing = await stream.until("status");
      expect(failing.freshness.failingRepositories).toBe(1);
      expect(failing.freshness.lastError).toContain("upstream unavailable");
      fail = false;
      stars = 32000;
      // Not due yet (backoff), so nothing happens...
      expect(await runtime.drainDeliveries()).toBe(0);
      // ...until the retry time arrives.
      expect(await runtime.drainDeliveries("2999-01-01T00:00:00.000Z")).toBe(1);
      expect(runtime.city.deliveryCounts()).toMatchObject({ pending: 0, done: 2 });
      await stream.until("lot_updated");

      // Admin enrollment of a new repository through the canonical resolver.
      const enrolled = await fetch(`${base}/api/city/lots`, {
        method: "POST",
        headers: { authorization: "Bearer admin" },
        body: JSON.stringify({ repo: "acme/new" }),
      });
      expect(enrolled.status).toBe(200);
      const added = await stream.until("lot_added");
      expect(added.placement.lot.stars).toBe(32000);
      expect(added.geometry.features.length).toBeGreaterThan(0);
      // Deliveries for enrolled lots publish events; unknown repositories do not.
      expect((await post("new-1", "acme/new")).status).toBe(202);
      await runtime.drainDeliveries();
      expect(((await (await fetch(`${base}/events`)).json()) as Array<{ repo: string }>).map((e) => e.repo)).toEqual([
        "acme/new",
        "acme/widget",
        "acme/widget",
      ]);
      stream.close();
      const reconnected = await streamReader(`${base}/api/city/stream`);
      const snapshot = await reconnected.until("snapshot");
      reconnected.close();
      expect(snapshot.plan.placements).toHaveLength(2);
      expect(snapshot.plan.placements[0].lot.stars).toBe(32000);
      expect(snapshot.revision).toBe(runtime.city.snapshot().revision);
      const history = (await (await fetch(`${base}/api/city/history?repo=acme/new`)).json()) as {
        history: Array<{ kind: string }>;
      };
      expect(history.history.map((h: { kind: string }) => h.kind)).toEqual(["added"]);
      await stop(runtime);
      const restarted = createCityStore(join(dir, "city.sqlite"));
      await restarted.load();
      expect(restarted.snapshot().plan.placements.map((p) => [p.lot.fullName, p.x, p.y])).toEqual(
        snapshot.plan.placements.map((p: { lot: { fullName: string }; x: number; y: number }) => [
          p.lot.fullName,
          p.x,
          p.y,
        ]),
      );
      expect(restarted.lots()[0].stars).toBe(32000);
      restarted.close();
    } finally {
      stream.close();
      if (runtime.server.listening) await stop(runtime);
    }
  });

  it("withdraws public data when a repository becomes private, unavailable, or is removed by an admin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-visibility-"));
    let mode: "ok" | "private" | "gone" = "ok";
    const runtime = createWebhookServer(
      {
        secret,
        adminToken: "admin",
        databasePath: join(dir, "city.sqlite"),
        coalesceMs: 0,
        resolveRepository: async (fullName) => {
          if (mode === "gone") throw new RepositoryUnavailableError(fullName, "not_found");
          const m = metrics({ fullName, isPrivate: mode !== "private" ? false : true });
          if (mode === "private") throw new RepositoryUnavailableError(fullName, "forbidden", "private");
          return { lot: parseLot(m), metrics: m };
        },
      },
      0,
    );
    const base = await start(runtime);
    try {
      for (const name of ["acme/a", "acme/b", "acme/c"]) await runtime.refreshRepository(name);
      const before = runtime.city.snapshot().plan.placements.map((p) => [p.lot.fullName, p.x, p.y]);
      const stream = await streamReader(`${base}/api/city/stream`);
      await stream.until("snapshot");
      const send = async (id: string, repo: string, event = "push", payload: Record<string, unknown> = {}) => {
        const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: repo }, ...payload });
        return fetch(`${base}/webhooks/github`, {
          method: "POST",
          body,
          headers: {
            "x-github-event": event,
            "x-github-delivery": id,
            "x-hub-signature-256": signBody(Buffer.from(body), secret),
          },
        });
      };
      await send("b-1", "acme/b");
      await runtime.drainDeliveries();
      expect(((await (await fetch(`${base}/events`)).json()) as Array<{ repo: string }>).map((e) => e.repo)).toEqual(["acme/b"]);
      // b becomes private: the next refresh withdraws it and its events vanish.
      mode = "private";
      await send("b-2", "acme/b");
      await runtime.drainDeliveries();
      const removed = await stream.until("lot_removed");
      expect(removed.fullName).toBe("acme/b");
      const snapshot = (await (await fetch(`${base}/api/city`)).json()) as {
        plan: { placements: Array<{ lot: { fullName: string }; x: number; y: number }> };
      };
      expect(snapshot.plan.placements.map((p) => [p.lot.fullName, p.x, p.y])).toEqual([
        before[0],
        before[2],
      ]);
      expect(await (await fetch(`${base}/events`)).json()).toEqual([]);
      expect((await fetch(`${base}/api/city/history?repo=acme/b`)).status).toBe(404);
      const svg = await (await fetch(`${base}/api/city/export.svg`)).text();
      expect(svg).toContain('data-repo="acme/a"');
      expect(svg).not.toContain("acme/b");
      // A private repository cannot be enrolled by an admin either.
      const denied = await fetch(`${base}/api/city/lots`, {
        method: "POST",
        headers: { authorization: "Bearer admin" },
        body: JSON.stringify({ repo: "acme/b" }),
      });
      expect(denied.status).toBe(422);
      // Deletion event withdraws immediately without a fetch.
      mode = "ok";
      await send("c-del", "acme/c", "repository", { action: "deleted" });
      await runtime.drainDeliveries();
      expect(runtime.city.lots().map((l) => l.fullName)).toEqual(["acme/a"]);
      // Admin removal.
      const gone = await fetch(`${base}/api/city/lots/acme%2Fa`, {
        method: "DELETE",
        headers: { authorization: "Bearer admin" },
      });
      expect(gone.status).toBe(200);
      expect(runtime.city.lots()).toEqual([]);
      expect(runtime.city.rows()).toHaveLength(3);
      stream.close();
    } finally {
      await stop(runtime);
    }
  });

  it("keeps last good values when a refresh cannot measure a field (finding A)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-partial-"));
    let unknown: RepoMetrics["unknownFields"] = [];
    let previousSeen: RepoMetrics | undefined;
    const runtime = createWebhookServer(
      {
        secret,
        databasePath: join(dir, "city.sqlite"),
        coalesceMs: 0,
        resolveRepository: async (fullName, previous) => {
          previousSeen = previous;
          const fresh = metrics({ fullName, openIssues: unknown?.length ? 0 : 9, unknownFields: unknown, isPrivate: false });
          if (unknown?.length) {
            if (!previous) throw new IncompleteRefreshError(fullName, unknown);
            const carried = { ...fresh, openIssues: previous.openIssues, unknownFields: [] };
            return {
              lot: parseLot(carried, { carried: { fields: unknown, from: previous.fetchedAt } }),
              metrics: carried,
            };
          }
          return { lot: parseLot(fresh), metrics: fresh };
        },
      },
      0,
    );
    await start(runtime);
    try {
      await runtime.refreshRepository("acme/w");
      expect(runtime.city.lots()[0].openIssues).toBe(9);
      unknown = ["openIssues"];
      await runtime.refreshRepository("acme/w");
      expect(previousSeen?.openIssues).toBe(9);
      const lot = runtime.city.lots()[0];
      expect(lot.openIssues).toBe(9);
      expect(lot.partial?.carriedFields).toEqual(["openIssues"]);
    } finally {
      await stop(runtime);
    }
  });
});

describe("repository-owned rules", () => {
  it("fetches repository JSON and actually changes both the building and loading zone", async () => {
    const request = (async (input: string | URL | Request) =>
      new Response(
        JSON.stringify(
          String(input).endsWith("building.json")
            ? { version: 1, buildingId: 42, quietAlpha: 0.4 }
            : {
                version: 1,
                props: { prs: ["blueprint"], recent: [], highPrsOrBot: [] },
                combinedBlueprint: false,
              },
        ),
        { status: 200 },
      )) as typeof fetch;
    const config = await loadRepositoryRules("acme/widget", DEFAULT_RULES, undefined, request);
    const lot = parseLot(
      metrics({ stars: 100, openPrs: 20, openIssues: 4, recentDefaultCommits: 3 }),
      { rules: config.rules },
    );
    expect(config.source).toBe("repository");
    expect(lot).toMatchObject({
      buildingId: 42,
      showBlueprint: true,
      showMaterials: false,
      showCrew: false,
      showDrone: false,
    });
  });

  it("coalesces a burst of deliveries into one deferred refresh instead of dropping later events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-coalesce-"));
    let stars = 100;
    let calls = 0;
    const runtime = createWebhookServer(
      {
        secret,
        adminToken: "admin",
        databasePath: join(dir, "city.sqlite"),
        coalesceMs: 400,
        resolveRepository: async (fullName) => {
          calls++;
          const m = metrics({ fullName, stars, isPrivate: false });
          return { lot: parseLot(m), metrics: m };
        },
      },
      0,
    );
    const base = await start(runtime);
    await runtime.city.hydrate([parseLot(metrics({ fullName: "acme/widget", stars: 1 }))]);
    const post = (id: string) => {
      const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "acme/widget" }, sender: { login: "human" } });
      return fetch(`${base}/webhooks/github`, {
        method: "POST",
        body,
        headers: { "x-github-event": "push", "x-github-delivery": id, "x-hub-signature-256": signBody(Buffer.from(body), secret) },
      });
    };
    try {
      expect((await post("burst-1")).status).toBe(202);
      await runtime.drainDeliveries();
      expect(calls).toBe(1);
      // Two more events arrive inside the window; the metric changed meanwhile.
      stars = 250;
      expect((await post("burst-2")).status).toBe(202);
      expect((await post("burst-3")).status).toBe(202);
      await runtime.drainDeliveries();
      expect(calls).toBe(1);
      expect(runtime.city.deliveryCounts()).toMatchObject({ pending: 2, done: 1, failed: 0 });
      expect(runtime.city.lots()[0].stars).toBe(100);
      // When the window ends the deferred deliveries run one refresh, which captures the change.
      await new Promise((r) => setTimeout(r, 600));
      await runtime.drainDeliveries();
      expect(calls).toBe(2);
      expect(runtime.city.lots()[0].stars).toBe(250);
      expect(runtime.city.deliveryCounts()).toMatchObject({ pending: 0, done: 3, failed: 0 });
    } finally {
      await stop(runtime);
    }
  });

  it("finishes a delivery interrupted between claim and completion after a crash, and a reconnecting stream sees the change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-crash-"));
    const databasePath = join(dir, "city.sqlite");
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const firstCalls: string[] = [];
    const first = createWebhookServer(
      {
        secret,
        databasePath,
        coalesceMs: 0,
        refreshTimeoutMs: 10_000,
        resolveRepository: async (fullName) => {
          firstCalls.push(fullName);
          await blocked; // GitHub answers only after this process is already dead
          const m = metrics({ fullName, stars: 555, isPrivate: false });
          return { lot: parseLot(m), metrics: m };
        },
      },
      0,
    );
    const base = await start(first);
    await first.city.hydrate([parseLot(metrics({ fullName: "acme/widget", stars: 1 }))]);
    const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "acme/widget" }, sender: { login: "human" } });
    const accepted = await fetch(`${base}/webhooks/github`, {
      method: "POST",
      body,
      headers: { "x-github-event": "push", "x-github-delivery": "crash-1", "x-hub-signature-256": signBody(Buffer.from(body), secret) },
    });
    expect(accepted.status).toBe(202);
    // Accepting a signed delivery kicks the worker, which claims it and is now waiting on GitHub.
    const inFlight = first.drainDeliveries().catch(() => undefined);
    while (first.city.deliveryCounts().processing !== 1) await new Promise((r) => setTimeout(r, 5));
    expect(first.city.deliveryCounts()).toMatchObject({ pending: 0, processing: 1, done: 0 });
    expect(firstCalls).toEqual(["acme/widget"]);
    // Crash: no graceful stop, the socket and the database simply go away mid-refresh.
    first.server.closeAllConnections();
    await new Promise<void>((done) => first.server.close(() => done()));
    first.city.close();
    release();
    await inFlight;

    let secondCalls = 0;
    const second = createWebhookServer(
      {
        secret,
        databasePath,
        coalesceMs: 0,
        refreshTimeoutMs: 10_000,
        resolveRepository: async (fullName) => {
          secondCalls++;
          const m = metrics({ fullName, stars: 777, isPrivate: false });
          return { lot: parseLot(m), metrics: m };
        },
      },
      0,
    );
    const base2 = await start(second);
    try {
      // Reopening returns the claimed-but-unfinished delivery to the queue; nothing was published by the dead process.
      expect(second.city.deliveryCounts()).toMatchObject({ pending: 1, processing: 0, done: 0, failed: 0 });
      expect(second.city.lots()[0].stars).toBe(1);
      expect(second.city.freshness().lastSuccessfulRefreshAt).toBeNull();
      const stream = await streamReader(`${base2}/api/city/stream`);
      await stream.until("snapshot");
      await second.drainDeliveries();
      expect(secondCalls).toBe(1);
      const update = await stream.until("lot_updated");
      expect(update.placement.lot.fullName).toBe("acme/widget");
      expect(update.placement.lot.stars).toBe(777);
      expect(second.city.lots()[0].stars).toBe(777);
      expect(second.city.deliveryCounts()).toMatchObject({ pending: 0, processing: 0, done: 1, failed: 0 });
      expect(second.city.freshness().lastSuccessfulRefreshAt).not.toBeNull();
      const redelivered = await fetch(`${base2}/webhooks/github`, {
        method: "POST",
        body,
        headers: { "x-github-event": "push", "x-github-delivery": "crash-1", "x-hub-signature-256": signBody(Buffer.from(body), secret) },
      });
      expect(redelivered.status).toBe(200); // the finished delivery is still remembered across the restart
      stream.close();
    } finally {
      await stop(second);
    }
  });

  it("bounds a slow GitHub response: the published lot stays, freshness records the failure, the delivery retries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-slow-"));
    let slow = true;
    let calls = 0;
    const runtime = createWebhookServer(
      {
        secret,
        databasePath: join(dir, "city.sqlite"),
        coalesceMs: 0,
        refreshTimeoutMs: 150,
        resolveRepository: async (fullName) => {
          calls++;
          if (slow) await new Promise((r) => setTimeout(r, 600));
          const m = metrics({ fullName, stars: 777, isPrivate: false });
          return { lot: parseLot(m), metrics: m };
        },
      },
      0,
    );
    const base = await start(runtime);
    await runtime.city.hydrate([parseLot(metrics({ fullName: "acme/widget", stars: 1 }))]);
    const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "acme/widget" }, sender: { login: "human" } });
    try {
      const response = await fetch(`${base}/webhooks/github`, {
        method: "POST",
        body,
        headers: { "x-github-event": "push", "x-github-delivery": "slow-1", "x-hub-signature-256": signBody(Buffer.from(body), secret) },
      });
      expect(response.status).toBe(202);
      await runtime.drainDeliveries();
      expect(calls).toBe(1);
      // The old lot is still published and nothing pretended to be fresh.
      expect(runtime.city.lots()[0].stars).toBe(1);
      const status = (await (await fetch(`${base}/api/city/status`)).json()) as {
        freshness: { lastError: string | null; lastSuccessfulRefreshAt: string | null; failingRepositories: number };
        deliveries: { pending: number; done: number; failed: number };
      };
      expect(status.freshness.lastError).toMatch(/timed out after 150 ms/);
      expect(status.freshness.lastSuccessfulRefreshAt).toBeNull();
      expect(status.freshness.failingRepositories).toBe(1);
      // Retry is scheduled from the local queue (attempt 1 → 30 s), not dropped and not marked done.
      expect(status.deliveries).toMatchObject({ pending: 1, done: 0, failed: 0 });
      const later = new Date(Date.now() + 31_000).toISOString();
      slow = false;
      await runtime.drainDeliveries(later);
      expect(calls).toBe(2);
      expect(runtime.city.lots()[0].stars).toBe(777);
      expect(runtime.city.deliveryCounts()).toMatchObject({ pending: 0, done: 1, failed: 0 });
      expect(runtime.city.freshness().failingRepositories).toBe(0);
    } finally {
      await stop(runtime);
    }
  });

  it("uses defaults only for absent/invalid rules; auth and transport failures fail the refresh", async () => {
    const absent = (async () => new Response(null, { status: 404 })) as typeof fetch;
    expect((await loadRepositoryRules("acme/widget", DEFAULT_RULES, undefined, absent)).source).toBe(
      "default",
    );
    const invalid = (async () => new Response('{"buildingId":999}', { status: 200 })) as typeof fetch;
    const result = await loadRepositoryRules("acme/widget", DEFAULT_RULES, undefined, invalid);
    expect(result.warning).toContain("buildingId");
    expect(result.rules.building.buildingId).toBeUndefined();
    const limited = (async () => new Response(null, { status: 403 })) as typeof fetch;
    await expect(loadRepositoryRules("acme/widget", DEFAULT_RULES, undefined, limited)).rejects.toThrow(
      "403",
    );
  });
});
