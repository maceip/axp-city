import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchViaGraphQl,
  fetchViaRest,
  RepositoryUnavailableError,
} from "../src/ingest/github.js";
import { appJwt, createAppTokenProvider, tokenProviderFromEnv } from "../src/ingest/githubApp.js";
import { IncompleteRefreshError, mergeMetrics } from "../src/ingest/merge.js";
import { fromGraphQl } from "../src/ingest/normalize.js";
import { createCityStore } from "../src/live/cityStore.js";
import { createReconciler, type CityAlert } from "../src/live/reconcile.js";
import { PrivateRepositoryError, resolveRepository } from "../src/live/repository.js";
import { renderCitySvg } from "../src/export/svg.js";
import { parseLot } from "../src/parser/parseLot.js";
import { isApproved, parseArtworkApprovals, pngDimensions, resolveArtwork } from "../src/rules/artwork.js";
import {
  DEFAULT_RULES,
  parseBuildingRules,
  parseLoadingZoneRules,
  parseYardLayout,
} from "../src/rules/cityFiles.js";
import { planCity } from "../src/world/layout.js";
import { FIXED_NOW, metrics } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

const graphRepo = {
  nameWithOwner: "acme/widget",
  url: "https://github.com/acme/widget",
  description: "d",
  databaseId: 42,
  isPrivate: false,
  stargazerCount: 42,
  forkCount: 3,
  diskUsage: 99,
  pushedAt: "2026-09-10T00:00:00Z",
  updatedAt: "2026-09-10T00:00:00Z",
  primaryLanguage: { name: "Kotlin" },
  languages: { edges: [{ size: 1000, node: { name: "Kotlin" } }] },
  issues: { totalCount: 7 },
  pullRequests: { totalCount: 2 },
  defaultBranchRef: {
    target: {
      recentCount: { totalCount: 1 },
      recent: {
        nodes: [
          { committedDate: "2026-09-10T00:00:00Z", authors: { nodes: [{ user: { login: "ada" } }] } },
          { committedDate: "2020-01-01T00:00:00Z", authors: { nodes: [{ user: { login: "old-bot[bot]" } }] } },
        ],
      },
    },
  },
  openPrAuthors: { nodes: [{ author: { login: "ada", __typename: "User" } }] },
};

describe("finding A: unknown fields are not zeros", () => {
  it("GraphQL field errors mark fields unknown instead of measuring zero", async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { r0: { ...graphRepo, issues: null } },
          errors: [{ message: "timeout", path: ["r0", "issues"] }],
        }),
      ),
    );
    const [row] = await fetchViaGraphQl([{ owner: "acme", name: "widget" }], {
      token: "t",
      request: request as unknown as typeof fetch,
      now: new Date(FIXED_NOW),
    });
    expect(row.unknownFields).toEqual(["openIssues"]);
    expect(row.repoId).toBe(42);
    expect(row.isPrivate).toBe(false);
    expect(() => mergeMetrics(undefined, row)).toThrow(IncompleteRefreshError);
    const merged = mergeMetrics(metrics({ openIssues: 12, unknownFields: [] }), row);
    expect(merged.metrics.openIssues).toBe(12);
    expect(merged.carried).toEqual(["openIssues"]);
    expect(merged.metrics.unknownFields).toEqual([]);
  });

  it("REST 503s on commits/languages produce unknown fields, not empty measurements", async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/pulls")) return new Response("[]");
      if (url.endsWith("/languages") || url.includes("/commits?"))
        return new Response("unavailable", { status: 503 });
      return new Response(
        JSON.stringify({
          id: 42,
          private: false,
          full_name: "acme/widget",
          html_url: "https://github.com/acme/widget",
          stargazers_count: 5,
          forks_count: 5,
          open_issues_count: 6,
          size: 100,
          description: null,
          pushed_at: null,
          updated_at: null,
          language: null,
        }),
      );
    });
    const [row] = await fetchViaRest([{ owner: "acme", name: "widget" }], {
      request: request as unknown as typeof fetch,
    });
    expect([...(row.unknownFields ?? [])].sort()).toEqual([
      "languageBytes",
      "recentAuthors",
      "recentDefaultCommits",
    ]);
    expect(row.openIssues).toBe(6);
    expect(row.source).toBe("github-rest");
  });

  it("classifies 404/403 as repository unavailable so callers withdraw instead of retrying blindly", async () => {
    const gone = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(
      fetchViaRest([{ owner: "acme", name: "gone" }], { request: gone as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(RepositoryUnavailableError);
    const graph = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { r0: null },
          errors: [{ message: "Could not resolve", type: "NOT_FOUND", path: ["r0"] }],
        }),
      ),
    );
    await expect(
      fetchViaGraphQl([{ owner: "acme", name: "gone" }], { token: "t", request: graph as unknown as typeof fetch }),
    ).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("finding B: author window", () => {
  it("excludes commit authors outside the activity window and records sampling", () => {
    const row = fromGraphQl(graphRepo, FIXED_NOW, { since: "2026-09-01T00:00:00Z" });
    expect(row.recentAuthors).toEqual(["ada"]);
    expect(row.authorSample).toMatchObject({ complete: true, recentCommitsInspected: 1 });
    const lot = parseLot(row, { now: FIXED_NOW });
    expect(lot.occupantClass).toBe("human");
    expect(lot.botDetected).toBe(false);
  });
});

describe("resolveRepository: one canonical path", () => {
  const rest = (private_ = false, extra: Record<string, Response> = {}) =>
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      for (const [needle, response] of Object.entries(extra)) if (url.includes(needle)) return response.clone();
      if (url.includes("/contents/")) return new Response(null, { status: 404 });
      if (url.includes("/pulls")) return new Response("[]");
      if (url.endsWith("/languages")) return new Response("{}");
      if (url.includes("/commits?")) return new Response("[]");
      return new Response(
        JSON.stringify({
          id: 42,
          private: private_,
          full_name: "acme/widget",
          html_url: "https://github.com/acme/widget",
          stargazers_count: 5,
          forks_count: 5,
          open_issues_count: 6,
          size: 100,
          description: null,
          pushed_at: null,
          updated_at: null,
          language: null,
        }),
      );
    });

  it("refuses to publish private repositories", async () => {
    await expect(
      resolveRepository("acme/widget", { token: "", request: rest(true) as unknown as typeof fetch, defaults: DEFAULT_RULES }),
    ).rejects.toBeInstanceOf(PrivateRepositoryError);
  });

  it("attaches approved artwork only after bytes, size, and hash verify", async () => {
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from([0, 0, 0, 13]),
      Buffer.from("IHDR"),
      Buffer.from([0, 0, 0, 64, 0, 0, 0, 96, 8, 6, 0, 0, 0]),
      Buffer.alloc(8),
    ]);
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(png).digest("hex");
    expect(pngDimensions(png)).toEqual({ width: 64, height: 96 });
    const building = new Response(
      JSON.stringify({ version: 2, artwork: { path: ".city/building.png", sha256, width: 64, height: 96 } }),
    );
    const dir = await mkdtemp(join(tmpdir(), "axp-art-"));
    const request = rest(false, {
      "building.json": building,
      "building.png": new Response(new Uint8Array(png), { headers: { "content-length": String(png.length) } }),
    }) as unknown as typeof fetch;
    const unapproved = await resolveRepository("acme/widget", {
      token: "",
      request,
      defaults: DEFAULT_RULES,
      approvals: { version: 1, approved: [] },
      artworkCacheDir: dir,
    });
    expect(unapproved.lot.artwork).toBeUndefined();
    expect(unapproved.lot.rulesWarning).toContain("not approved");
    const approvals = parseArtworkApprovals({ version: 1, approved: [{ repo: "acme/widget", sha256 }] });
    expect(isApproved(approvals, "ACME/Widget", sha256)).toBe(true);
    const approved = await resolveRepository("acme/widget", {
      token: "",
      request,
      defaults: DEFAULT_RULES,
      approvals,
      artworkCacheDir: dir,
    });
    expect(approved.lot.artwork).toEqual({ sha256, width: 64, height: 96, url: `/assets/artwork/${sha256}.png` });
    // Wrong bytes for the declared hash keep the catalog building.
    const tampered = await resolveArtwork(
      "acme/widget",
      { path: ".city/building.png", sha256: "0".repeat(64), width: 64, height: 96 },
      parseArtworkApprovals({ version: 1, approved: [{ repo: "acme/widget", sha256: "0".repeat(64) }] }),
      dir,
      undefined,
      request,
    );
    expect(tampered.artwork).toBeUndefined();
    expect(tampered.warning).toContain("sha256");
  });
});

describe("rules version 2", () => {
  it("accepts layouts inside placement constraints and rejects the rest", () => {
    const layout = parseYardLayout({
      bays: 2,
      slots: [
        { prop: "cones", x: 0.2, y: 0.3 },
        { prop: "lamp", x: 1.5, y: 2.0 },
      ],
    });
    expect(layout.bays).toBe(2);
    expect(() => parseYardLayout({ bays: 4 })).toThrow(/bays/);
    expect(() => parseYardLayout({ slots: [{ prop: "lamp", x: 5, y: 0 }] })).toThrow(/inside the yard/);
    expect(() =>
      parseYardLayout({ slots: [{ prop: "lamp", x: 0.5, y: 0.5 }, { prop: "bench", x: 0.6, y: 0.5 }] }),
    ).toThrow(/closer than/);
    expect(() => parseYardLayout({ slots: [{ prop: "fountain", x: 0.5, y: 0.5 }] })).toThrow(/known prop/);
  });

  it("gates decor props, layouts, and artwork behind version 2 and rejects unknown versions", () => {
    expect(() => parseLoadingZoneRules({ version: 1, props: { recent: ["lamp"] } })).toThrow(/version 2/);
    const v2 = parseLoadingZoneRules({
      version: 2,
      props: { recent: ["crew", "lamp"] },
      layout: { bays: 3, slots: [] },
    });
    expect(v2.props.recent).toEqual(["crew", "lamp"]);
    expect(v2.layout?.bays).toBe(3);
    expect(() => parseBuildingRules({ version: 1, artwork: {} })).toThrow(/Unknown building.artwork/);
    expect(() => parseBuildingRules({ version: 3 })).toThrow(/not supported/);
    const lot = parseLot(
      metrics({ openPrs: 3, pushedAt: "2026-09-10T00:00:00Z" }),
      { now: FIXED_NOW, rules: { building: DEFAULT_RULES.building, loadingZone: v2 } },
    );
    expect(lot.extraProps).toEqual(["lamp"]);
    expect(lot.layout?.bays).toBe(3);
  });
});

describe("GitHub App credentials", () => {
  it("signs an RS256 JWT and caches installation tokens until near expiry", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const jwt = appJwt("1234", pem, 1_700_000_000);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iat: 1_700_000_000 - 60,
      exp: 1_700_000_000 + 540,
      iss: "1234",
    });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);

    let now = Date.parse("2026-09-16T10:00:00Z");
    let minted = 0;
    const request = vi.fn(async () => {
      minted++;
      return new Response(
        JSON.stringify({ token: `ghs_${minted}`, expires_at: new Date(now + 3_600_000).toISOString() }),
      );
    });
    const provider = createAppTokenProvider(
      { appId: "1234", privateKey: pem, installationId: "99" },
      request as unknown as typeof fetch,
      () => now,
    );
    expect(provider.kind).toBe("github-app");
    expect(await provider.token()).toBe("ghs_1");
    expect(await provider.token()).toBe("ghs_1");
    now += 56 * 60_000;
    expect(await provider.token()).toBe("ghs_2");
    expect(request).toHaveBeenCalledTimes(2);
    const body = JSON.parse((request.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.permissions).toEqual({ metadata: "read", contents: "read" });
  });

  it("prefers App credentials, falls back to a token, and rejects half-configured Apps", () => {
    expect(tokenProviderFromEnv({ GITHUB_TOKEN: "x" }).kind).toBe("github-token");
    expect(tokenProviderFromEnv({}).kind).toBe("github-anonymous");
    expect(() => tokenProviderFromEnv({ GITHUB_APP_ID: "1" })).toThrow(/together/);
  });
});

describe("reconciler", () => {
  it("refreshes every published lot, records failures, and alerts on stale/recovered transitions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-reconcile-"));
    const store = createCityStore(join(dir, "city.sqlite"), { staleAfterMs: 60_000 });
    await store.load();
    for (const name of ["acme/a", "acme/b"])
      await store.ensure(name, parseLot(metrics({ fullName: name })), FIXED_NOW);
    let clock = Date.parse(FIXED_NOW);
    let fail = false;
    const alerts: CityAlert[] = [];
    const refreshed: string[] = [];
    const reconciler = createReconciler({
      city: store,
      intervalMs: 1000,
      now: () => clock,
      alert: (alert) => {
        alerts.push(alert);
      },
      refresh: async (name) => {
        refreshed.push(name);
        if (fail) {
          store.recordRefresh({ fullName: name, at: new Date(clock).toISOString(), ok: false, error: "boom" });
          throw new Error("boom");
        }
        store.recordRefresh({ fullName: name, at: new Date(clock).toISOString(), ok: true });
      },
    });
    const first = await reconciler.run();
    expect(first).toMatchObject({ attempted: 2, succeeded: 2, failed: [] });
    expect(refreshed).toEqual(["acme/a", "acme/b"]);
    expect(reconciler.isStale()).toBe(false);
    fail = true;
    clock += 120_000;
    const second = await reconciler.run();
    expect(second?.failed).toEqual(["acme/a", "acme/b"]);
    expect(reconciler.isStale()).toBe(true);
    expect(alerts.map((a) => a.kind)).toEqual(["stale", "refresh_failures"]);
    fail = false;
    await reconciler.run();
    expect(alerts.map((a) => a.kind)).toEqual(["stale", "refresh_failures", "recovered"]);
    store.close();
  });
});

describe("SVG export", () => {
  it("renders the shared plan with one group per published lot and sprite crops", () => {
    const lots = ["acme/a", "acme/b"].map((name) =>
      parseLot(metrics({ fullName: name, openPrs: 3, pushedAt: "2026-09-10T00:00:00Z" }), { now: FIXED_NOW }),
    );
    const plan = planCity(lots, { now: FIXED_NOW });
    const svg = renderCitySvg({ plan, serverTime: FIXED_NOW, revision: 3 }, { assetBase: "./sprites/" });
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg.match(/class="lot"/g)).toHaveLength(2);
    expect(svg).toContain('data-repo="acme/a"');
    expect(svg).toContain('href="./sprites/buildings-');
    expect(svg).toContain('href="./sprites/v2-raw-materials-k1.png"');
    expect(svg).toContain('data-revision="3"');
    const still = renderCitySvg({ plan, serverTime: FIXED_NOW, revision: 3 }, { detail: false });
    expect(still).not.toContain("v2-raw-materials");
    expect(still.match(/class="lot"/g)).toHaveLength(2);
  });
});
