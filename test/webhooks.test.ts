import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCityStore, type CityStore } from "../src/live/cityStore.js";
import { parseLot } from "../src/parser/parseLot.js";
import {
  clientAddress,
  createRateLimiter,
  createWebhookServer,
  handleDelivery,
  normalizeDelivery,
  signBody,
  signatureMatches,
  type WebhookServer,
} from "../src/webhooks/index.js";
import { metrics } from "./helpers.js";

const SECRET = "test-secret-123";
const NOW = "2026-09-12T00:00:00.000Z";

const resolveTestLot = async (fullName: string) => {
  const m = metrics({ fullName, isPrivate: false });
  return { lot: parseLot(m), metrics: m };
};

function pushPayload(repo = "acme/widget") {
  return {
    ref: "refs/heads/main",
    compare: "https://github.com/acme/widget/compare/a...b",
    repository: { full_name: repo, id: 42 },
    sender: { login: "octocat" },
  };
}

function prPayload(action: string, merged = false) {
  return {
    action,
    pull_request: {
      number: 7,
      title: "Fix widgets",
      html_url: "https://github.com/acme/widget/pull/7",
      merged,
    },
    repository: { full_name: "acme/widget" },
    sender: { login: "octocat" },
  };
}

async function tempStore(): Promise<{ store: CityStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-"));
  const store = createCityStore(join(dir, "city.sqlite"));
  await store.load();
  return { store, dir };
}

async function listen(runtime: WebhookServer): Promise<string> {
  await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

async function shutdown(runtime: WebhookServer): Promise<void> {
  await runtime.stopWorker();
  runtime.server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    runtime.server.close((error) => (error ? reject(error) : resolve())),
  );
  runtime.city.close();
}

describe("signatureMatches", () => {
  it("accepts a valid signature", () => {
    const raw = Buffer.from(JSON.stringify(pushPayload()));
    expect(signatureMatches(raw, SECRET, signBody(raw, SECRET))).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, and malformed headers", () => {
    const raw = Buffer.from(JSON.stringify(pushPayload()));
    const good = signBody(raw, SECRET);
    expect(signatureMatches(Buffer.from(`${raw} `), SECRET, good)).toBe(false);
    expect(signatureMatches(raw, "other-secret", good)).toBe(false);
    expect(signatureMatches(raw, SECRET, undefined)).toBe(false);
    expect(signatureMatches(raw, SECRET, "not-a-signature")).toBe(false);
    expect(signatureMatches(raw, SECRET, "sha256=zzzz")).toBe(false);
    expect(signatureMatches(raw, "", good)).toBe(false);
  });
});

describe("normalizeDelivery", () => {
  it("maps ping, push, PR lifecycle, and issues", () => {
    expect(
      normalizeDelivery("ping", { repository: { full_name: "a/b" } }, "d1", NOW)?.signal,
    ).toBe("ping");
    expect(normalizeDelivery("push", pushPayload(), "d2", NOW)).toMatchObject({
      signal: "push",
      repo: "acme/widget",
      repoId: 42,
      ref: "refs/heads/main",
      actor: "octocat",
    });
    expect(normalizeDelivery("pull_request", prPayload("opened"), "d3", NOW)?.signal).toBe(
      "pr_opened",
    );
    expect(
      normalizeDelivery("pull_request", prPayload("closed", true), "d4", NOW),
    ).toMatchObject({ signal: "pr_merged", number: 7, merged: true });
    expect(
      normalizeDelivery("pull_request", prPayload("closed", false), "d5", NOW)?.signal,
    ).toBe("pr_closed");
    expect(
      normalizeDelivery(
        "issues",
        { action: "opened", issue: { number: 3 }, repository: { full_name: "a/b" } },
        "d6",
        NOW,
      )?.signal,
    ).toBe("issue_opened");
  });

  it("maps repository lifecycle: rename, transfer, deletion, privatization", () => {
    expect(
      normalizeDelivery(
        "repository",
        {
          action: "renamed",
          changes: { repository: { name: { from: "old" } } },
          repository: { full_name: "acme/new", id: 42 },
        },
        "r1",
        NOW,
      ),
    ).toMatchObject({ signal: "repo_renamed", repo: "acme/new", previousRepo: "acme/old", repoId: 42 });
    expect(
      normalizeDelivery(
        "repository",
        {
          action: "transferred",
          changes: { owner: { from: { user: { login: "acme" } } } },
          repository: { full_name: "newco/widget", id: 42 },
        },
        "r2",
        NOW,
      ),
    ).toMatchObject({ signal: "repo_transferred", previousRepo: "acme/widget" });
    expect(
      normalizeDelivery("repository", { action: "deleted", repository: { full_name: "a/b" } }, "r3", NOW)
        ?.signal,
    ).toBe("repo_removed");
    expect(
      normalizeDelivery("repository", { action: "privatized", repository: { full_name: "a/b" } }, "r4", NOW)
        ?.signal,
    ).toBe("repo_privatized");
  });

  it("returns null for unhandled actions and missing repos", () => {
    expect(normalizeDelivery("pull_request", prPayload("labeled"), "d", NOW)).toBeNull();
    expect(normalizeDelivery("star", { repository: { full_name: "a/b" } }, "d", NOW)).toBeNull();
    expect(normalizeDelivery("push", { sender: {} }, "d", NOW)).toBeNull();
    expect(
      normalizeDelivery(
        "repository",
        { action: "created", repository: { full_name: "acme/fresh" } },
        "d7",
        NOW,
      ),
    ).toMatchObject({ signal: "repo_created", repo: "acme/fresh" });
  });
});

describe("handleDelivery", () => {
  function deliver(
    store: CityStore,
    event: string,
    payload: unknown,
    deliveryId: string | undefined,
    secret = SECRET,
    allowUnsigned = false,
  ) {
    const raw = Buffer.from(JSON.stringify(payload));
    return handleDelivery(
      { "x-github-event": event, "x-hub-signature-256": signBody(raw, secret) },
      raw,
      deliveryId,
      { secret: SECRET, allowUnsigned },
      store,
    );
  }

  it("queues a signed push durably before acknowledging", async () => {
    const { store } = await tempStore();
    const result = deliver(store, "push", pushPayload(), "del-1");
    expect(result.status).toBe(202);
    expect(result.body).toBe("queued");
    expect(result.event?.signal).toBe("push");
    expect(store.deliveryCounts().pending).toBe(1);
    // Nothing is public until the worker verifies the repository.
    expect(store.recentEvents(10)).toHaveLength(0);
    store.close();
  });

  it("dedups redeliveries by delivery id", async () => {
    const { store } = await tempStore();
    expect(deliver(store, "push", pushPayload(), "del-9").body).toBe("queued");
    const again = deliver(store, "push", pushPayload(), "del-9");
    expect(again.status).toBe(200);
    expect(again.body).toBe("duplicate");
    expect(again.event).toBeUndefined();
    expect(store.deliveryCounts().pending).toBe(1);
    store.close();
  });

  it("rejects unsigned, bad json, missing ids, and invalid repositories; allows unsigned only in dev", async () => {
    const { store } = await tempStore();
    const raw = Buffer.from(JSON.stringify(pushPayload()));
    expect(handleDelivery({ "x-github-event": "push" }, raw, "del-x", { secret: SECRET }, store).status).toBe(
      401,
    );
    const dev = handleDelivery(
      { "x-github-event": "push" },
      raw,
      "del-y",
      { secret: "", allowUnsigned: true },
      store,
    );
    expect(dev.status).toBe(202);
    const badJson = Buffer.from("{nope");
    expect(
      handleDelivery(
        { "x-github-event": "push", "x-hub-signature-256": signBody(badJson, SECRET) },
        badJson,
        "del-z",
        { secret: SECRET },
        store,
      ).status,
    ).toBe(400);
    expect(deliver(store, "push", pushPayload(), undefined).status).toBe(400);
    expect(deliver(store, "push", pushPayload("../etc"), "del-w").status).toBe(400);
    store.close();
  });

  it("answers 500 on storage failure without recording the delivery", async () => {
    const { store } = await tempStore();
    store.database.exec("DROP TABLE deliveries");
    const failed = deliver(store, "push", pushPayload(), "retry-1");
    expect(failed.status).toBe(500);
    expect(failed.body).toBe("storage failure");
    store.close();
  });
});

describe("rate limiting behind a proxy", () => {
  it("allows max per window, then 429s with a retry hint", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(limiter.check("1.2.3.4", 0)).toMatchObject({ allowed: true });
    expect(limiter.check("1.2.3.4", 10)).toMatchObject({ allowed: true });
    const limited = limiter.check("1.2.3.4", 20);
    expect(limited.allowed).toBe(false);
    expect(limited.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.check("5.6.7.8", 20).allowed).toBe(true);
    expect(limiter.check("1.2.3.4", 1001).allowed).toBe(true);
  });

  it("uses X-Forwarded-For only from trusted proxies and ignores spoofed chains", () => {
    expect(clientAddress("127.0.0.1", "203.0.113.9")).toBe("203.0.113.9");
    expect(clientAddress("127.0.0.1", "10.0.0.1, 203.0.113.9")).toBe("203.0.113.9");
    // A client behind the proxy cannot hide behind a fabricated trusted hop.
    expect(clientAddress("127.0.0.1", "203.0.113.9, 127.0.0.1")).toBe("203.0.113.9");
    // Direct callers cannot impersonate anyone.
    expect(clientAddress("198.51.100.7", "203.0.113.9")).toBe("198.51.100.7");
    expect(clientAddress("127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(clientAddress("10.1.1.1", "203.0.113.9", ["10.1.1.1"])).toBe("203.0.113.9");
  });
});

describe("webhook server", () => {
  it("queues a push, processes it, and serves it back over /events with readiness diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-srv-"));
    const runtime = createWebhookServer(
      {
        secret: SECRET,
        databasePath: join(dir, "city.sqlite"),
        resolveRepository: resolveTestLot,
        clientRoot: join(dir, "missing-client"),
      },
      0,
    );
    await runtime.city.load();
    await runtime.city.hydrate([parseLot(metrics({ fullName: "acme/widget" }))]);
    const base = await listen(runtime);
    try {
      const raw = JSON.stringify(pushPayload());
      const posted = await fetch(`${base}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": "srv-1",
          "x-hub-signature-256": signBody(Buffer.from(raw), SECRET),
        },
        body: raw,
      });
      expect(posted.status).toBe(202);
      expect(await posted.text()).toBe("queued");
      await runtime.drainDeliveries();
      const events = await fetch(`${base}/events?limit=10`);
      const list = (await events.json()) as Array<{ signal: string }>;
      expect(list).toHaveLength(1);
      expect(list[0].signal).toBe("push");
      const health = await fetch(`${base}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, lots: 1 });
      // Readiness fails without a client bundle and says why.
      const ready = await fetch(`${base}/readyz`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({
        ready: false,
        checks: { clientBundle: false, storageWritable: true },
      });
      const status = (await (await fetch(`${base}/api/city/status`)).json()) as {
        deliveries: { done: number };
        config: { rateLimitMax: number };
        freshness: { lastSuccessfulRefreshAt: string | null };
      };
      expect(status.deliveries.done).toBe(1);
      expect(status.config.rateLimitMax).toBe(120);
      expect(status.freshness.lastSuccessfulRefreshAt).not.toBeNull();
      expect((await fetch(`${base}/nope`)).status).toBe(404);
    } finally {
      await shutdown(runtime);
    }
  });

  it("ignores deliveries for repositories that were never enrolled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-unknown-"));
    let resolves = 0;
    const runtime = createWebhookServer(
      {
        secret: SECRET,
        databasePath: join(dir, "city.sqlite"),
        resolveRepository: async (name) => {
          resolves++;
          return resolveTestLot(name);
        },
      },
      0,
    );
    await runtime.city.load();
    const raw = Buffer.from(JSON.stringify(pushPayload("acme/stranger")));
    handleDelivery(
      { "x-github-event": "push", "x-hub-signature-256": signBody(raw, SECRET) },
      raw,
      "u-1",
      { secret: SECRET },
      runtime.city,
    );
    await runtime.drainDeliveries();
    expect(resolves).toBe(0);
    expect(runtime.city.deliveryCounts().ignored).toBe(1);
    expect(runtime.city.lots()).toHaveLength(0);
    runtime.city.close();
  });

  it("serves a status page at /status with attacker content escaped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-page-"));
    const runtime = createWebhookServer(
      { secret: SECRET, databasePath: join(dir, "city.sqlite"), resolveRepository: resolveTestLot },
      0,
    );
    await runtime.city.load();
    await runtime.city.hydrate([parseLot(metrics({ fullName: "a/b" }))]);
    const base = await listen(runtime);
    try {
      const evil = {
        action: "opened",
        pull_request: { number: 1, title: '"><script>alert(1)</script>', html_url: "x" },
        repository: { full_name: "a/b" },
        sender: { login: "<img src=x>" },
      };
      const raw = JSON.stringify(evil);
      const posted = await fetch(`${base}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "evil-1",
          "x-hub-signature-256": signBody(Buffer.from(raw), SECRET),
        },
        body: raw,
      });
      expect(posted.status).toBe(202);
      await runtime.drainDeliveries();
      const page = await fetch(`${base}/status`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      const html = await page.text();
      expect(html).toContain("AXP City status");
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<img src=x>");
    } finally {
      await shutdown(runtime);
    }
  });

  it("rate-limits floods with 429 and a Retry-After hint, keyed by the forwarded client", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-rl-"));
    const runtime = createWebhookServer(
      {
        secret: SECRET,
        databasePath: join(dir, "city.sqlite"),
        rateLimitMax: 1,
        rateLimitWindowMs: 60_000,
        resolveRepository: resolveTestLot,
      },
      0,
    );
    await runtime.city.load();
    const base = await listen(runtime);
    const post = (id: string, forwardedFor?: string) => {
      const raw = JSON.stringify(pushPayload());
      return fetch(`${base}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": id,
          "x-hub-signature-256": signBody(Buffer.from(raw), SECRET),
          ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        },
        body: raw,
      });
    };
    try {
      expect((await post("rl-1", "203.0.113.1")).status).toBe(202);
      const limited = await post("rl-2", "203.0.113.1");
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(await limited.text()).toBe("rate limited");
      // The loopback test client is a trusted proxy, so another forwarded client has its own bucket.
      expect((await post("rl-3", "203.0.113.2")).status).toBe(202);
      expect(runtime.effectiveConfig).toMatchObject({ rateLimitMax: 1, rateLimitWindowMs: 60_000 });
    } finally {
      await shutdown(runtime);
    }
  });
});
