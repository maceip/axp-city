import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createWebhookServer, signBody } from "../src/webhooks/index.js";
import { createCityStore } from "../src/live/cityStore.js";
import { parseLot } from "../src/parser/parseLot.js";
import { loadRepositoryRules } from "../src/rules/load.js";
import { DEFAULT_RULES } from "../src/rules/cityFiles.js";
import { metrics } from "./helpers.js";
const secret = "city-integration-test";
async function streamReader(url: string) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body!.getReader();
  let buffer = "";
  return {
    close: () => controller.abort(),
    async next() {
      while (!buffer.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("stream ended");
        buffer += new TextDecoder().decode(chunk.value);
      }
      const index = buffer.indexOf("\n\n"),
        frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      return JSON.parse(
        frame
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6),
      );
    },
  };
}
describe("live city contract", () => {
  it("applies signed changes to real lots, broadcasts JSON, deduplicates deliveries, and resynchronizes after reconnect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-live-"));
    let stars = 26000,
      fail = false,
      calls = 0;
    const runtime = createWebhookServer(
      {
        secret,
        adminToken: "admin",
        logPath: join(dir, "events.jsonl"),
        resolveRepository: async (fullName) => {
          calls++;
          if (fail) throw new Error("upstream unavailable");
          return parseLot(
            metrics({
              fullName,
              stars,
              openPrs: 8,
              openIssues: 5,
              recentDefaultCommits: 2,
            }),
          );
        },
      },
      0,
    );
    await runtime.city.hydrate([
      parseLot(metrics({ fullName: "acme/widget", stars: 100 })),
    ]);
    await new Promise<void>((done) =>
      runtime.server.listen(0, "127.0.0.1", done),
    );
    const port = (runtime.server.address() as { port: number }).port,
      base = `http://127.0.0.1:${port}`;
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
          "x-hub-signature-256": signed
            ? signBody(Buffer.from(body), secret)
            : "bad",
        },
      });
    };
    const stream = await streamReader(`${base}/api/city/stream`);
    try {
      const initial = await stream.next();
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
      expect((await post("update-1")).status).toBe(200);
      const event = await stream.next();
      expect(event.type).toBe("lot_updated");
      expect(event).not.toHaveProperty("svg");
      expect(event).not.toHaveProperty("hit");
      expect(event.placement.lot).toMatchObject({
        stars: 26000,
        openPrs: 8,
        openIssues: 5,
        buildingBand: "L",
        showMaterials: true,
        showCrew: true,
      });
      expect([event.placement.x, event.placement.y]).toEqual([
        first.x,
        first.y,
      ]);
      const duplicates = await Promise.all([
        post("update-1"),
        post("update-1"),
      ]);
      expect(await duplicates[0].text()).toBe("duplicate");
      expect(calls).toBe(1);
      fail = true;
      expect((await post("retry")).status).toBe(500);
      expect(runtime.store.has("retry")).toBe(false);
      expect(runtime.city.lots()[0].stars).toBe(26000);
      fail = false;
      stars = 32000;
      expect((await post("retry")).status).toBe(200);
      await stream.next();
      expect((await post("new-1", "acme/new")).status).toBe(200);
      const added = await stream.next();
      expect(added.type).toBe("lot_added");
      expect(added.placement.lot.stars).toBe(32000);
      expect(added.geometry.features.length).toBeGreaterThan(0);
      stream.close();
      const reconnected = await streamReader(`${base}/api/city/stream`);
      const snapshot = await reconnected.next();
      reconnected.close();
      expect(snapshot.plan.placements).toHaveLength(2);
      expect(snapshot.plan.placements[0].lot.stars).toBe(32000);
      expect(snapshot.revision).toBe(runtime.city.snapshot().revision);
      const restarted = createCityStore(join(dir, "city-map.json"));
      await restarted.load();
      expect(
        restarted
          .snapshot()
          .plan.placements.map((p) => [p.lot.fullName, p.x, p.y]),
      ).toEqual(
        snapshot.plan.placements.map(
          (p: { lot: { fullName: string }; x: number; y: number }) => [
            p.lot.fullName,
            p.x,
            p.y,
          ],
        ),
      );
      expect(restarted.lots()[0].stars).toBe(32000);
    } finally {
      stream.close();
      runtime.server.closeAllConnections();
      await new Promise<void>((done) => runtime.server.close(() => done()));
    }
  });
  it("retains version-1 map addresses and never publishes a failed persistence write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-migrate-")),
      path = join(dir, "map.json");
    const lots = [
      parseLot(metrics({ fullName: "acme/z" })),
      parseLot(metrics({ fullName: "acme/a" })),
    ];
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        order: lots.map((l) => l.fullName),
        lots,
        addedAt: { "acme/z": "2020-01-01T00:00:00Z" },
      }),
    );
    const store = createCityStore(path);
    await store.load();
    const before = store.snapshot();
    await mkdir(`${path}.tmp`);
    await expect(
      store.ensure("acme/fail", parseLot(metrics({ fullName: "acme/fail" }))),
    ).rejects.toThrow();
    expect(store.snapshot().plan.placements).toEqual(before.plan.placements);
    expect(JSON.parse(await readFile(path, "utf8")).order).toEqual([
      "acme/z",
      "acme/a",
    ]);
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
    const config = await loadRepositoryRules(
      "acme/widget",
      DEFAULT_RULES,
      undefined,
      request,
    );
    const lot = parseLot(
      metrics({
        stars: 100,
        openPrs: 20,
        openIssues: 4,
        recentDefaultCommits: 3,
      }),
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
  it("uses defaults only for absent/invalid rules; auth and transport failures fail the refresh", async () => {
    const absent = (async () =>
      new Response(null, { status: 404 })) as typeof fetch;
    expect(
      (
        await loadRepositoryRules(
          "acme/widget",
          DEFAULT_RULES,
          undefined,
          absent,
        )
      ).source,
    ).toBe("default");
    const invalid = (async () =>
      new Response('{"buildingId":999}', { status: 200 })) as typeof fetch;
    const result = await loadRepositoryRules(
      "acme/widget",
      DEFAULT_RULES,
      undefined,
      invalid,
    );
    expect(result.warning).toContain("buildingId");
    expect(result.rules.building.buildingId).toBeUndefined();
    const limited = (async () =>
      new Response(null, { status: 403 })) as typeof fetch;
    await expect(
      loadRepositoryRules("acme/widget", DEFAULT_RULES, undefined, limited),
    ).rejects.toThrow("403");
  });
});
