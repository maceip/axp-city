import { mkdtemp, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCityStore,
  lotsEquivalent,
  STORAGE_SCHEMA,
} from "../src/live/cityStore.js";
import { parseCity, parseLot } from "../src/parser/index.js";
import { authorizeAdmin, secretMatches } from "../src/webhooks/auth.js";
import { lotSlot } from "../src/world/slots.js";
import { FIXED_NOW, metrics } from "./helpers.js";

async function tempDir(prefix = "axp-city-") {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("secretMatches", () => {
  it("accepts the expected token and rejects others, including empty", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abc", "xyz")).toBe(false);
    expect(secretMatches("", "abc")).toBe(false);
    expect(secretMatches("abc", "")).toBe(false);
  });
});

describe("authorizeAdmin", () => {
  it("requires a bearer token and never infers success from a missing config", () => {
    expect(authorizeAdmin({ authorization: "Bearer secret" }, "secret").ok).toBe(true);
    expect(authorizeAdmin({ authorization: "Bearer nope" }, "secret").ok).toBe(false);
    expect(authorizeAdmin({}, "secret").ok).toBe(false);
    expect(authorizeAdmin({ authorization: "Bearer secret" }, "").ok).toBe(false);
  });
});

describe("createCityStore (SQLite)", () => {
  it("assigns a sticky plot, emits construction for a new repo, and survives restart", async () => {
    const dir = await tempDir();
    const store = createCityStore(join(dir, "city.sqlite"));
    await store.load();
    const first = parseCity([metrics({ fullName: "acme/alpha", stars: 100 })], {
      now: FIXED_NOW,
    });
    await store.hydrate(first);
    expect(await store.ensure("acme/alpha")).toBeNull();
    const added = await store.ensure(
      "acme/fresh",
      parseCity([metrics({ fullName: "acme/fresh" })])[0],
    );
    expect(added?.type).toBe("lot_added");
    if (added?.type !== "lot_added") throw new Error("expected lot_added");
    expect(added.placement.lot.fullName).toBe("acme/fresh");
    expect(added.placement.constructing).toBe(true);
    expect(store.lots().map((l) => l.fullName)).toEqual(["acme/alpha", "acme/fresh"]);
    store.close();
    const reloaded = createCityStore(join(dir, "city.sqlite"));
    await reloaded.load();
    expect(reloaded.lots().map((l) => l.fullName)).toEqual(["acme/alpha", "acme/fresh"]);
    expect(reloaded.snapshot().schema).toEqual({ snapshot: 2, layout: 1 });
    reloaded.close();
  });

  it("imports a legacy version-1 JSON map and event log without moving any address", async () => {
    const dir = await tempDir("axp-migrate-");
    const lots = [
      parseLot(metrics({ fullName: "acme/z" })),
      parseLot(metrics({ fullName: "acme/a" })),
      parseLot(metrics({ fullName: "acme/m" })),
    ];
    // Legacy lots predate crewBasis; the importer must accept them.
    for (const lot of lots) delete (lot as Partial<typeof lot>).crewBasis;
    await writeFile(
      join(dir, "city-map.json"),
      JSON.stringify({
        version: 1,
        revision: 7,
        order: ["acme/z", "acme/a", "acme/m"],
        lots,
        addedAt: { "acme/z": "2020-01-01T00:00:00Z" },
      }),
    );
    await writeFile(
      join(dir, "city-events.jsonl"),
      [
        JSON.stringify({ id: "e1", receivedAt: FIXED_NOW, repo: "acme/z", signal: "push", actor: null }),
        "{torn",
        JSON.stringify({ id: "e2", receivedAt: FIXED_NOW, repo: "acme/a", signal: "ping", actor: null }),
      ].join("\n"),
    );
    const store = createCityStore(join(dir, "city.sqlite"));
    expect((await store.load()).migrated).toBe(true);
    const placements = store.snapshot().plan.placements;
    expect(placements.map((p) => [p.lot.fullName, p.col, p.row])).toEqual(
      ["acme/z", "acme/a", "acme/m"].map((name, i) => {
        const slot = lotSlot(i);
        return [name, slot.sx, slot.sy];
      }),
    );
    expect(store.snapshot().revision).toBe(7);
    expect(store.lots()[0].crewBasis).toContain("predates");
    expect(store.recentEvents(10).map((e) => e.id)).toEqual(["e2", "e1"]);
    const files = await readdir(dir);
    expect(files.some((f) => f.startsWith("city-map.json.imported-"))).toBe(true);
    expect(files).not.toContain("city-map.json");
    store.close();
  });

  it("refuses unknown storage schema versions and mode mismatches instead of guessing", async () => {
    const dir = await tempDir("axp-schema-");
    const store = createCityStore(join(dir, "city.sqlite"), { mode: "live" });
    await store.load();
    store.database.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(
      String(STORAGE_SCHEMA + 1),
    );
    store.close();
    await expect(createCityStore(join(dir, "city.sqlite")).load()).rejects.toThrow(/schema/);
    const other = await tempDir("axp-mode-");
    const live = createCityStore(join(other, "city.sqlite"), { mode: "live" });
    await live.load();
    live.close();
    await expect(
      createCityStore(join(other, "city.sqlite"), { mode: "offline" }).load(),
    ).rejects.toThrow(/offline mode/);
  });

  it("keeps a renamed or transferred repository at its address via the GitHub id", async () => {
    const dir = await tempDir("axp-rename-");
    const store = createCityStore(join(dir, "city.sqlite"));
    await store.load();
    const original = parseLot(metrics({ fullName: "acme/widget", repoId: 42 }));
    const neighbour = parseLot(metrics({ fullName: "acme/other", repoId: 43 }));
    await store.ensure("acme/widget", original, FIXED_NOW, metrics({ repoId: 42, isPrivate: false }));
    await store.ensure("acme/other", neighbour, FIXED_NOW);
    const before = store.snapshot().plan.placements.map((p) => [p.lot.fullName, p.col, p.row]);
    const renamed = await store.ensure(
      "acme/widget",
      parseLot(metrics({ fullName: "newco/gadget", owner: "newco", name: "gadget", repoId: 42 })),
    );
    expect(renamed?.type).toBe("lot_renamed");
    if (renamed?.type !== "lot_renamed") throw new Error("expected rename");
    expect(renamed.previousFullName).toBe("acme/widget");
    const after = store.snapshot().plan.placements.map((p) => [p.lot.fullName, p.col, p.row]);
    expect(after).toEqual([["newco/gadget", before[0][1], before[0][2]], before[1]]);
    expect(store.row("acme/widget")).toBeUndefined();
    expect(store.row("newco/gadget")?.repoId).toBe(42);
    expect(store.history("newco/gadget").map((h) => h.kind)).toEqual(["added", "renamed"]);
    // Two different repositories can never claim the same lot.
    await expect(
      store.ensure("acme/other", parseLot(metrics({ fullName: "newco/gadget", repoId: 43 }))),
    ).rejects.toThrow(/identity conflict/);
    store.close();
  });

  it("withdraws a lot without shifting neighbours, removes its events, and restores in place", async () => {
    const dir = await tempDir("axp-withdraw-");
    const store = createCityStore(join(dir, "city.sqlite"));
    await store.load();
    for (const name of ["acme/a", "acme/b", "acme/c"])
      await store.ensure(name, parseLot(metrics({ fullName: name })), FIXED_NOW);
    store.appendEvent({ id: "b1", receivedAt: FIXED_NOW, repo: "acme/b", signal: "push", actor: null });
    store.appendEvent({ id: "c1", receivedAt: FIXED_NOW, repo: "acme/c", signal: "push", actor: null });
    const before = store.snapshot().plan.placements.map((p) => [p.lot.fullName, p.col, p.row]);
    const removed = await store.withdraw("acme/b", "became private");
    expect(removed?.type).toBe("lot_removed");
    const after = store.snapshot().plan.placements.map((p) => [p.lot.fullName, p.col, p.row]);
    expect(after).toEqual([before[0], before[2]]);
    expect(store.recentEvents(10).map((e) => e.id)).toEqual(["c1"]);
    expect(await store.withdraw("acme/b", "again")).toBeNull();
    // The vacated slot is a tombstone: a newcomer gets the next free slot instead.
    const added = await store.ensure("acme/d", parseLot(metrics({ fullName: "acme/d" })));
    if (added?.type !== "lot_added") throw new Error("expected lot_added");
    expect([added.placement.col, added.placement.row]).not.toEqual([before[1][1], before[1][2]]);
    const restored = await store.ensure("acme/b", parseLot(metrics({ fullName: "acme/b" })));
    expect(restored?.type).toBe("lot_added");
    if (restored?.type !== "lot_added") throw new Error("expected restore");
    expect([restored.placement.col, restored.placement.row]).toEqual([before[1][1], before[1][2]]);
    expect(store.history("acme/b").map((h) => h.kind)).toEqual(["added", "withdrawn", "restored"]);
    store.close();
  });

  it("rejects private repositories and treats freshness-only refreshes as no visible change", async () => {
    const dir = await tempDir("axp-private-");
    const store = createCityStore(join(dir, "city.sqlite"));
    await store.load();
    await expect(
      store.ensure(
        "acme/secret",
        parseLot(metrics({ fullName: "acme/secret" })),
        FIXED_NOW,
        metrics({ fullName: "acme/secret", isPrivate: true }),
      ),
    ).rejects.toThrow(/private/);
    expect(store.lots()).toHaveLength(0);
    const lot = parseLot(metrics({ fullName: "acme/w" }));
    await store.ensure("acme/w", lot, FIXED_NOW);
    const revision = store.snapshot().revision;
    const again = await store.ensure("acme/w", { ...lot, fetchedAt: "2030-01-01T00:00:00.000Z" });
    expect(again).toBeNull();
    expect(store.snapshot().revision).toBe(revision);
    expect(lotsEquivalent(lot, { ...lot, fetchedAt: "x", dataSource: "github-rest" })).toBe(true);
    expect(lotsEquivalent(lot, { ...lot, stars: lot.stars + 1 })).toBe(false);
    store.close();
  });

  it("runs the durable delivery queue: persist, claim, retry, fail, prune, recover on restart", async () => {
    const dir = await tempDir("axp-queue-");
    const path = join(dir, "city.sqlite");
    const retention = { deliveryDays: 1, eventDays: 1, eventsKeep: 1 };
    let store = createCityStore(path, { retention });
    await store.load();
    const event = { id: "d1", receivedAt: FIXED_NOW, repo: "acme/w", signal: "push" as const, actor: null };
    expect(store.enqueueDelivery(event, true)).toBe(true);
    expect(store.enqueueDelivery(event, true)).toBe(false);
    expect(store.hasDelivery("d1")).toBe(true);
    const claimed = store.nextDelivery();
    expect(claimed?.status).toBe("processing");
    expect(store.nextDelivery()).toBeUndefined();
    // Crash while processing: reopening returns the delivery to pending.
    store.close();
    store = createCityStore(path, { retention });
    await store.load();
    expect(store.deliveryCounts().pending).toBe(1);
    const retry = store.nextDelivery()!;
    store.failDelivery(retry.id, "upstream 503", "2999-01-01T00:00:00.000Z");
    expect(store.nextDelivery()).toBeUndefined();
    expect(store.nextDelivery("2999-01-02T00:00:00.000Z")?.attempts).toBe(1);
    store.failDelivery("d1", "gave up", null);
    expect(store.deliveryCounts().failed).toBe(1);
    store.enqueueDelivery({ ...event, id: "d2" }, true);
    store.nextDelivery();
    store.completeDelivery("d2", "2020-01-01T00:00:00.000Z");
    for (let i = 0; i < 3; i++)
      store.appendEvent({ ...event, id: `old-${i}`, receivedAt: "2020-01-01T00:00:00.000Z" });
    const pruned = store.prune(FIXED_NOW);
    expect(pruned.deliveries).toBe(1);
    expect(pruned.events).toBe(2);
    expect(store.eventCount()).toBe(1);
    const backup = join(dir, "backups", "city.sqlite");
    await store.backup(backup);
    const restored = createCityStore(backup);
    await restored.load();
    expect(restored.deliveryCounts().failed).toBe(1);
    expect(restored.writable()).toBe(true);
    restored.close();
    store.close();
  });

  it("records refresh outcomes separately from connection state", async () => {
    const dir = await tempDir("axp-fresh-");
    const store = createCityStore(join(dir, "city.sqlite"), { staleAfterMs: 1000 });
    await store.load();
    expect(store.freshness()).toMatchObject({
      lastSuccessfulRefreshAt: null,
      failingRepositories: 0,
      staleAfterMs: 1000,
    });
    await store.ensure("acme/a", parseLot(metrics({ fullName: "acme/a" })), FIXED_NOW);
    await store.ensure("acme/b", parseLot(metrics({ fullName: "acme/b" })), FIXED_NOW);
    store.recordRefresh({ fullName: "acme/a", at: FIXED_NOW, ok: true });
    store.recordRefresh({ fullName: "acme/b", at: FIXED_NOW, ok: false, error: "503" });
    expect(store.freshness()).toMatchObject({
      lastSuccessfulRefreshAt: FIXED_NOW,
      lastError: "503",
      failingRepositories: 1,
    });
    store.recordRefresh({ fullName: "acme/b", at: FIXED_NOW, ok: true });
    expect(store.freshness().failingRepositories).toBe(0);
    // A refused enrollment is answered to the caller; it is not a degraded city.
    store.recordRefresh({ fullName: "acme/private", at: FIXED_NOW, ok: false, error: "private repository" });
    expect(store.freshness().failingRepositories).toBe(0);
    expect(store.freshness().lastError).toBeNull();
    store.close();
  });

  it("never publishes a failed persistence write", async () => {
    const dir = await tempDir("axp-failwrite-");
    const store = createCityStore(join(dir, "city.sqlite"));
    await store.load();
    await store.ensure("acme/a", parseLot(metrics({ fullName: "acme/a" })), FIXED_NOW);
    const before = store.snapshot();
    let emitted = 0;
    store.onMutation(() => emitted++);
    store.database.exec("DROP TABLE lot_history");
    await expect(
      store.ensure("acme/fail", parseLot(metrics({ fullName: "acme/fail" }))),
    ).rejects.toThrow();
    expect(emitted).toBe(0);
    expect(store.snapshot().plan.placements).toEqual(before.plan.placements);
    expect(store.snapshot().revision).toBe(before.revision);
    store.close();
  });
});
