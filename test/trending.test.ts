import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fetchTrendingPage,
  mergeTrending,
  obtainTrending,
  parseTrendingHtml,
  parseTrendingPayload,
} from "../src/ingest/trending.js";
import { createTrendingSync } from "../src/live/trendingSync.js";
import { createCityStore } from "../src/live/cityStore.js";
import { parseLot } from "../src/parser/parseLot.js";
import { FIXED_NOW, metrics } from "./helpers.js";

const SAMPLE_HTML = `
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/alibaba/open-code-review">alibaba / open-code-review</a>
  </h2>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/cloudflare/security-audit-skill">cloudflare / security-audit-skill</a>
  </h2>
</article>
<a href="/topics/javascript">ignore</a>
<a href="/login">ignore</a>
`;

describe("GitHub trending parser", () => {
  it("reads ranked owner/name links from a trending HTML page", () => {
    expect(parseTrendingHtml(SAMPLE_HTML)).toEqual([
      "alibaba/open-code-review",
      "cloudflare/security-audit-skill",
    ]);
  });

  it("reads a recorded JSON snapshot", () => {
    const lists = parseTrendingPayload(
      JSON.stringify({
        daily: ["a/one", "a/one"],
        weekly: ["b/two"],
        monthly: ["c/three"],
      }),
    );
    expect(lists.daily).toEqual(["a/one"]);
    expect(lists.weekly).toEqual(["b/two"]);
    expect(lists.monthly).toEqual(["c/three"]);
  });

  it("gives daily the address when a repo appears in several windows", () => {
    const ranked = mergeTrending({
      daily: ["acme/hot", "acme/day"],
      weekly: ["acme/hot", "acme/week"],
      monthly: ["acme/hot", "acme/month"],
      fetchedAt: FIXED_NOW,
      source: "test-fixture",
    });
    expect(ranked).toEqual([
      { fullName: "acme/hot", cadence: "daily" },
      { fullName: "acme/day", cadence: "daily" },
      { fullName: "acme/week", cadence: "weekly" },
      { fullName: "acme/month", cadence: "monthly" },
    ]);
  });
});

describe("obtainTrending", () => {
  it("loads an explicit test fixture and never pretends it is live GitHub", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-trending-"));
    const fixture = join(dir, "trending.json");
    await writeFile(
      fixture,
      JSON.stringify({ daily: ["fix/a"], weekly: ["fix/b"], monthly: [] }),
    );
    const result = await obtainTrending({
      cachePath: join(dir, "cache.json"),
      fixturePath: fixture,
    });
    expect(result.ok).toBe(true);
    expect(result.lists?.source).toBe("test-fixture");
    expect(result.lists?.daily).toEqual(["fix/a"]);
  });

  it("keeps the last-good cache when the live fetch fails and does not invent fixture repos", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-trending-"));
    const cache = join(dir, "cache.json");
    await writeFile(
      cache,
      JSON.stringify({
        daily: ["keep/me"],
        weekly: [],
        monthly: [],
        fetchedAt: FIXED_NOW,
        source: "github-trending",
      }),
    );
    const result = await obtainTrending({
      cachePath: cache,
      request: async () => {
        throw new Error("GitHub trending unreachable");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.usedCache).toBe(true);
    expect(result.error).toMatch(/unreachable/);
    expect(result.lists?.daily).toEqual(["keep/me"]);
    expect(result.lists?.source).toBe("last-good-cache");
  });

  it("returns no lists when live fetch fails and there is no cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-trending-"));
    const result = await obtainTrending({
      cachePath: join(dir, "missing.json"),
      request: async () => {
        throw new Error("down");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.lists).toBeNull();
    expect(result.usedCache).toBe(false);
  });

  it("writes a live snapshot after a successful fetch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-trending-"));
    const cache = join(dir, "cache.json");
    const pages = {
      daily: SAMPLE_HTML,
      weekly: `<h2><a href="/week/one">week / one</a></h2>`,
      monthly: `<h2><a href="/month/one">month / one</a></h2>`,
    };
    const result = await obtainTrending({
      cachePath: cache,
      request: async (url) => {
        const href = String(url);
        const since = href.includes("monthly")
          ? "monthly"
          : href.includes("weekly")
            ? "weekly"
            : "daily";
        return new Response(pages[since], { status: 200 });
      },
    });
    expect(result.ok).toBe(true);
    expect(result.lists?.source).toBe("github-trending");
    expect(result.lists?.daily[0]).toBe("alibaba/open-code-review");
    const saved = JSON.parse(await readFile(cache, "utf8"));
    expect(saved.source).toBe("github-trending");
    expect(saved.weekly).toEqual(["week/one"]);
  });

  it("rejects an empty trending page instead of inventing repositories", async () => {
    await expect(
      fetchTrendingPage("daily", async () => new Response("<html></html>", { status: 200 })),
    ).rejects.toThrow(/no repositories/);
  });
});

describe("trending city sync", () => {
  it("enrolls cadence lots, keeps addresses, and withdraws drop-offs only after a live fetch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-city-"));
    const store = createCityStore(join(dir, "city.sqlite"), { mode: "offline" });
    await store.load();
    store.setIdentity({ name: "Trending City", kind: "trending" });
    const fixture = join(dir, "trending.json");
    await writeFile(
      fixture,
      JSON.stringify({
        daily: ["trend/daily-one"],
        weekly: ["trend/weekly-one"],
        monthly: ["trend/monthly-one"],
      }),
    );
    const known = new Map([
      ["trend/daily-one", parseLot(metrics({ fullName: "trend/daily-one", owner: "trend", name: "daily-one", stars: 10 }))],
      ["trend/weekly-one", parseLot(metrics({ fullName: "trend/weekly-one", owner: "trend", name: "weekly-one", stars: 20 }))],
      ["trend/monthly-one", parseLot(metrics({ fullName: "trend/monthly-one", owner: "trend", name: "monthly-one", stars: 30 }))],
      ["trend/gone", parseLot(metrics({ fullName: "trend/gone", owner: "trend", name: "gone" }))],
    ]);
    await store.ensure("trend/gone", known.get("trend/gone"));
    const sync = createTrendingSync({
      city: store,
      dataDir: dir,
      fixturePath: fixture,
      intervalMs: 60_000,
      enabled: true,
      refresh: async (name, extra) => {
        const lot = known.get(name);
        if (!lot) throw new Error(`no fixture for ${name}`);
        await store.ensure(name, { ...lot, cadence: extra?.cadence });
      },
    });
    const first = await sync.run();
    expect(first?.ok).toBe(true);
    expect(store.lots().map((l) => l.fullName).sort()).toEqual([
      "trend/daily-one",
      "trend/monthly-one",
      "trend/weekly-one",
    ]);
    const daily = store.row("trend/daily-one")!;
    expect(daily.lot.cadence).toBe("daily");
    expect(store.snapshot("offline").city).toEqual({ name: "Trending City", kind: "trending" });
    expect(store.plan().placements.find((p) => p.lot.fullName === "trend/daily-one")?.district).toBe(
      "Daily Projects",
    );
    await store.ensure("trend/daily-one", {
      ...known.get("trend/daily-one")!,
      cadence: "daily",
      stars: 99,
    });
    expect(store.row("trend/daily-one")?.slot).toEqual(daily.slot);
    expect(store.row("trend/gone")?.status).toBe("withdrawn");

    await writeFile(
      fixture,
      JSON.stringify({ daily: ["trend/daily-one"], weekly: [], monthly: [] }),
    );
    const second = await sync.run();
    expect(second?.withdrawn.sort()).toEqual(["trend/monthly-one", "trend/weekly-one"]);
    expect(store.row("trend/daily-one")?.slot).toEqual(daily.slot);
    store.close();
  });
});
