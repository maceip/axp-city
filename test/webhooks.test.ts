import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEventStore,
  createRateLimiter,
  createWebhookServer,
  handleDelivery,
  normalizeDelivery,
  signBody,
  signatureMatches,
  type EventStore,
} from "../src/webhooks/index.js";

const SECRET = "test-secret-123";
const NOW = "2026-09-12T00:00:00.000Z";

function pushPayload() {
  return {
    ref: "refs/heads/main",
    compare: "https://github.com/acme/widget/compare/a...b",
    repository: { full_name: "acme/widget" },
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

async function tempStore(): Promise<{ store: EventStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-"));
  return { store: createEventStore(join(dir, "events.jsonl")), dir };
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
  async function deliver(
    store: EventStore,
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

  it("stores a signed push and persists it to JSONL", async () => {
    const { store, dir } = await tempStore();
    const result = await deliver(store, "push", pushPayload(), "del-1");
    expect(result.status).toBe(200);
    expect(result.body).toBe("ok");
    expect(result.event?.signal).toBe("push");
    expect(store.recent(10)).toHaveLength(1);
    const lines = (await readFile(join(dir, "events.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).signal).toBe("push");
  });

  it("dedups redeliveries by delivery id", async () => {
    const { store } = await tempStore();
    expect((await deliver(store, "push", pushPayload(), "del-9")).body).toBe("ok");
    const again = await deliver(store, "push", pushPayload(), "del-9");
    expect(again.status).toBe(200);
    expect(again.body).toBe("duplicate");
    expect(again.event).toBeUndefined();
    expect(store.recent(10)).toHaveLength(1);
  });

  it("rejects unsigned, unsigned-dev, bad json, and missing ids", async () => {
    const { store } = await tempStore();
    const raw = Buffer.from(JSON.stringify(pushPayload()));
    const noSig = await handleDelivery(
      { "x-github-event": "push" },
      raw,
      "del-x",
      { secret: SECRET },
      store,
    );
    expect(noSig.status).toBe(401);

    const devStore = (await tempStore()).store;
    const dev = await handleDelivery(
      { "x-github-event": "push" },
      raw,
      "del-y",
      { secret: "", allowUnsigned: true },
      devStore,
    );
    expect(dev.status).toBe(200);
    expect(dev.event?.signal).toBe("push");

    const badJson = Buffer.from("{nope");
    const bad = await handleDelivery(
      {
        "x-github-event": "push",
        "x-hub-signature-256": signBody(badJson, SECRET),
      },
      badJson,
      "del-z",
      { secret: SECRET },
      store,
    );
    expect(bad.status).toBe(400);

    const noId = await deliver(store, "push", pushPayload(), undefined);
    expect(noId.status).toBe(400);
  });
});

describe("createRateLimiter", () => {
  it("allows max per window, then 429s with a retry hint", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(limiter.check("1.2.3.4", 0)).toMatchObject({ allowed: true });
    expect(limiter.check("1.2.3.4", 10)).toMatchObject({ allowed: true });
    const limited = limiter.check("1.2.3.4", 20);
    expect(limited.allowed).toBe(false);
    expect(limited.retryAfterMs).toBeGreaterThan(0);
    // Other clients are unaffected; the window reset re-opens the gate.
    expect(limiter.check("5.6.7.8", 20).allowed).toBe(true);
    expect(limiter.check("1.2.3.4", 1001).allowed).toBe(true);
  });
});

describe("event store recovery", () => {
  it("replays the log on startup and skips corrupt lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-load-"));
    const logPath = join(dir, "events.jsonl");
    await writeFile(
      logPath,
      [
        JSON.stringify({ id: "a", receivedAt: NOW, repo: "a/b", signal: "push", actor: null }),
        "{torn",
        JSON.stringify({ id: "b", receivedAt: NOW, repo: "a/b", signal: "ping", actor: null }),
        JSON.stringify({ id: "a", receivedAt: NOW, repo: "a/b", signal: "push", actor: null }),
        JSON.stringify({ nope: true }),
        "",
      ].join("\n"),
      "utf8",
    );
    const store = createEventStore(logPath);
    const { loaded, skipped } = await store.load();
    expect(loaded).toBe(2);
    expect(skipped).toBe(2);
    expect(store.recent(10).map((event) => event.id)).toEqual(["b", "a"]);
    // Replayed ids still dedup redeliveries.
    expect(
      await store.append({ id: "a", receivedAt: NOW, repo: "a/b", signal: "push", actor: null }),
    ).toBe(false);
  });

  it("starts empty when no log exists yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-fresh-"));
    const store = createEventStore(join(dir, "events.jsonl"));
    await expect(store.load()).resolves.toEqual({ loaded: 0, skipped: 0 });
  });

  it("answers 500 on storage failure and lets the retry land", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-fail-"));
    // A log path that IS a directory: appends fail (EISDIR).
    const collidingDir = join(dir, "a-dir");
    await mkdir(collidingDir);
    const broken = createEventStore(collidingDir);

    const raw = Buffer.from(JSON.stringify(pushPayload()));
    const headers = {
      "x-github-event": "push",
      "x-hub-signature-256": signBody(raw, SECRET),
    };
    const failed = await handleDelivery(headers, raw, "retry-1", { secret: SECRET }, broken);
    expect(failed.status).toBe(500);
    expect(failed.body).toBe("storage failure");
    // Write-then-ack: the failed delivery was NOT marked seen…
    expect(broken.has("retry-1")).toBe(false);
    // …so the retry (e.g. after a restart replays the log) still lands.
    const healthy = createEventStore(join(dir, "events.jsonl"));
    const retried = await handleDelivery(headers, raw, "retry-1", { secret: SECRET }, healthy);
    expect(retried.status).toBe(200);
    expect(retried.body).toBe("ok");
  });
});

describe("webhook server", () => {
  it("receives a push and serves it back over /events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-srv-"));
    const { server } = createWebhookServer(
      { secret: SECRET, logPath: join(dir, "events.jsonl") },
      0,
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const raw = JSON.stringify(pushPayload());
      const posted = await fetch(`http://127.0.0.1:${port}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": "srv-1",
          "x-hub-signature-256": signBody(Buffer.from(raw), SECRET),
        },
        body: raw,
      });
      expect(posted.status).toBe(200);
      expect(await posted.text()).toBe("ok");

      const events = await fetch(`http://127.0.0.1:${port}/events?limit=10`);
      expect(events.status).toBe(200);
      const list = (await events.json()) as Array<{ signal: string }>;
      expect(list).toHaveLength(1);
      expect(list[0].signal).toBe("push");

      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, stored: 1 });

      const missing = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("serves a status page at / with attacker content escaped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-page-"));
    const { server } = createWebhookServer(
      { secret: SECRET, logPath: join(dir, "events.jsonl") },
      0,
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const evil = {
        action: "opened",
        pull_request: {
          number: 1,
          title: '"><script>alert(1)</script>',
          html_url: "x",
        },
        repository: { full_name: "a/b" },
        sender: { login: "<img src=x>" },
      };
      const raw = JSON.stringify(evil);
      const posted = await fetch(`http://127.0.0.1:${port}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "evil-1",
          "x-hub-signature-256": signBody(Buffer.from(raw), SECRET),
        },
        body: raw,
      });
      expect(posted.status).toBe(200);
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      const html = await page.text();
      expect(html).toContain("AXP City webhook catcher");
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<img src=x>");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rate-limits floods with 429 and a Retry-After hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-webhooks-rl-"));
    const { server } = createWebhookServer(
      { secret: SECRET, logPath: join(dir, "events.jsonl"), rateLimitMax: 1, rateLimitWindowMs: 60_000 },
      0,
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const post = (id: string) => {
      const raw = JSON.stringify(pushPayload());
      return fetch(`http://127.0.0.1:${port}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": id,
          "x-hub-signature-256": signBody(Buffer.from(raw), SECRET),
        },
        body: raw,
      });
    };
    try {
      expect((await post("rl-1")).status).toBe(200);
      const limited = await post("rl-2");
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(await limited.text()).toBe("rate limited");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
