import { describe, expect, it } from "vitest";
import {
  HIGH_PR_COUNT,
  RECENT_ACTIVITY_DAYS,
  buildingBandFromStars,
  classifyCrew,
  hasRecentActivity,
  isBotLogin,
  parseCity,
  parseLot,
  pickBuildingId,
} from "../src/parser/index.js";
import { DEFAULT_RULES } from "../src/rules/cityFiles.js";
import { FIXED_NOW, metrics } from "./helpers.js";

const STAR_BAND_SMALL_MAX = DEFAULT_RULES.building.bands.S.maxStarsExclusive!;
const STAR_BAND_MEDIUM_MAX = DEFAULT_RULES.building.bands.M.maxStarsExclusive!;

const opts = { now: FIXED_NOW, recentDays: RECENT_ACTIVITY_DAYS };

describe("buildingBandFromStars", () => {
  it("maps S / M / L on documented star thresholds", () => {
    expect(buildingBandFromStars(0)).toBe("S");
    expect(buildingBandFromStars(STAR_BAND_SMALL_MAX - 1)).toBe("S");
    expect(buildingBandFromStars(STAR_BAND_SMALL_MAX)).toBe("M");
    expect(buildingBandFromStars(STAR_BAND_MEDIUM_MAX - 1)).toBe("M");
    expect(buildingBandFromStars(STAR_BAND_MEDIUM_MAX)).toBe("L");
    expect(buildingBandFromStars(80_000)).toBe("L");
  });
});

describe("pickBuildingId", () => {
  it("stays inside the band catalog and is stable per repo", () => {
    const a = pickBuildingId("acme/widget", "S");
    const b = pickBuildingId("acme/widget", "S");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(17);

    const mid = pickBuildingId("acme/widget", "M");
    expect(mid).toBeGreaterThanOrEqual(18);
    expect(mid).toBeLessThanOrEqual(34);

    const large = pickBuildingId("acme/widget", "L");
    expect(large).toBeGreaterThanOrEqual(35);
    expect(large).toBeLessThanOrEqual(50);
  });
});

describe("hasRecentActivity", () => {
  it("treats pushed_at inside the window as recent", () => {
    const row = metrics({ pushedAt: "2026-09-01T00:00:00.000Z" });
    expect(hasRecentActivity(row, opts)).toBe(true);
  });

  it("treats pushed_at older than N days as stale", () => {
    const row = metrics({ pushedAt: "2026-08-20T00:00:00.000Z" });
    expect(hasRecentActivity(row, opts)).toBe(false);
  });

  it("ORs in default-branch commit activity even when push is old", () => {
    const row = metrics({
      pushedAt: "2025-01-01T00:00:00.000Z",
      recentDefaultCommits: 3,
    });
    expect(hasRecentActivity(row, opts)).toBe(true);
  });
});

describe("parseLot yard states", () => {
  it("fully dormant: no recent push/commits and no open issues/PRs", () => {
    const lot = parseLot(metrics(), opts);
    expect(lot.yard).toBe("fully_dormant");
    expect(lot.showBlueprint).toBe(false);
    expect(lot.showDraftingTable).toBe(false);
    expect(lot.showMaterials).toBe(false);
    expect(lot.showCrew).toBe(false);
    expect(lot.showDrone).toBe(false);
    expect(lot.recentActivity).toBe(false);
    expect(lot.occupantClass).toBe("none");
  });

  it("issues quiet: open issues, no recent activity, no crew", () => {
    const lot = parseLot(metrics({ openIssues: 4 }), opts);
    expect(lot.yard).toBe("issues_quiet");
    expect(lot.showDraftingTable).toBe(true);
    expect(lot.showBlueprint).toBe(true);
    expect(lot.showCrew).toBe(false);
    expect(lot.showMaterials).toBe(false);
    expect(lot.showDrone).toBe(false);
  });

  it("issues active: open issues + recent activity → blueprints and crew", () => {
    const lot = parseLot(
      metrics({
        openIssues: 4,
        pushedAt: "2026-09-10T00:00:00.000Z",
      }),
      opts,
    );
    expect(lot.yard).toBe("issues_active");
    expect(lot.showDraftingTable).toBe(true);
    expect(lot.showBlueprint).toBe(true);
    expect(lot.showCrew).toBe(true);
    expect(lot.showMaterials).toBe(false);
    expect(lot.occupantClass).toBe("human");
  });

  it("PRs quiet: open PRs, no recent activity → materials, empty sidewalk", () => {
    const lot = parseLot(metrics({ openPrs: 3 }), opts);
    expect(lot.yard).toBe("prs_quiet");
    expect(lot.showMaterials).toBe(true);
    expect(lot.showCrew).toBe(false);
    expect(lot.showDraftingTable).toBe(false);
    expect(lot.showDrone).toBe(false);
  });

  it("PRs active: open PRs + recent activity → materials and movers", () => {
    const lot = parseLot(
      metrics({
        openPrs: 3,
        pushedAt: "2026-09-08T12:00:00.000Z",
      }),
      opts,
    );
    expect(lot.yard).toBe("prs_active");
    expect(lot.showMaterials).toBe(true);
    expect(lot.showCrew).toBe(true);
  });

  it("prefers PR state over issue state when both are present", () => {
    const quiet = parseLot(
      metrics({ openIssues: 12, openPrs: 2 }),
      opts,
    );
    expect(quiet.yard).toBe("prs_quiet");
    expect(quiet.showMaterials).toBe(true);
    expect(quiet.showBlueprint).toBe(true);
    expect(quiet.showDraftingTable).toBe(false);

    const active = parseLot(
      metrics({
        openIssues: 12,
        openPrs: 2,
        recentDefaultCommits: 1,
      }),
      opts,
    );
    expect(active.yard).toBe("prs_active");
    expect(active.showCrew).toBe(true);
    expect(active.showBlueprint).toBe(true);
  });

  it("idle_active: recent work but a clean issues/PR board", () => {
    const lot = parseLot(
      metrics({ pushedAt: "2026-09-09T00:00:00.000Z" }),
      opts,
    );
    expect(lot.yard).toBe("idle_active");
    expect(lot.showMaterials).toBe(false);
    expect(lot.showBlueprint).toBe(false);
    expect(lot.showCrew).toBe(false);
  });
});

describe("drones and bots", () => {
  it("shows a drone when open PRs reach HIGH_PR_COUNT", () => {
    const lot = parseLot(metrics({ openPrs: HIGH_PR_COUNT }), opts);
    expect(lot.showDrone).toBe(true);
    expect(lot.botDetected).toBe(false);
  });

  it("shows a drone when a bot author is present, even with few PRs", () => {
    const lot = parseLot(
      metrics({
        openPrs: 2,
        prAuthors: [{ login: "hosted-weblate", type: "Bot" }],
      }),
      opts,
    );
    expect(lot.botDetected).toBe(true);
    expect(lot.showDrone).toBe(true);
    expect(lot.occupantClass).toBe("robot");
  });

  it("does not drone issue-only lots", () => {
    const lot = parseLot(
      metrics({
        openIssues: 40,
        prAuthors: [{ login: "dependabot[bot]", type: "Bot" }],
      }),
      opts,
    );
    expect(lot.yard).toBe("issues_quiet");
    expect(lot.showDrone).toBe(false);
  });
});

describe("isBotLogin", () => {
  it("recognizes GraphQL Bot typename and known logins", () => {
    expect(isBotLogin("weblate", "Bot")).toBe(true);
    expect(isBotLogin("semantic-release-bot")).toBe(true);
    expect(isBotLogin("renovate[bot]")).toBe(true);
    expect(isBotLogin("david-allison")).toBe(false);
    expect(isBotLogin("2dust")).toBe(false);
  });
});

describe("silhouette policy", () => {
  it("is stable per repository, stays inside the band, and honours explicit overrides", () => {
    const lots = parseCity(
      [
        metrics({ fullName: "a/one", owner: "a", name: "one", stars: 25_000 }),
        metrics({ fullName: "b/two", owner: "b", name: "two", stars: 25_000 }),
        metrics({ fullName: "c/three", owner: "c", name: "three", stars: 25_000 }),
      ],
      opts,
    );
    const ids = lots.map((l) => l.buildingId);
    expect(ids.every((id) => id >= 35 && id <= 50)).toBe(true);
    expect(parseCity(lots.map((l) => metrics({ fullName: l.fullName, stars: 25_000 })), opts).map((l) => l.buildingId)).toEqual(ids);
    const forced = parseLot(metrics({ stars: 25_000 }), {
      ...opts,
      rules: { ...DEFAULT_RULES, building: { ...DEFAULT_RULES.building, buildingId: 40 } },
    });
    expect(forced.buildingId).toBe(40);
  });
});

describe("crew classification (finding B)", () => {
  it("labels mixed, robot, human, unknown, and none with a written basis", () => {
    const active = { pushedAt: "2026-09-10T00:00:00.000Z", openPrs: 2 };
    const mixed = parseLot(
      metrics({ ...active, recentAuthors: ["alice"], prAuthors: [{ login: "renovate[bot]", type: "Bot" }] }),
      opts,
    );
    expect(mixed.occupantClass).toBe("mixed");
    expect(mixed.crewBasis).toMatch(/human accounts \(1\)/);
    const robot = parseLot(metrics({ ...active, recentAuthors: ["dependabot[bot]"] }), opts);
    expect(robot.occupantClass).toBe("robot");
    expect(robot.crewBasis).toContain("heuristic");
    const human = parseLot(metrics({ ...active, recentAuthors: ["alice"] }), opts);
    expect(human.occupantClass).toBe("human");
    const unknown = parseLot(
      metrics({ ...active, unknownFields: ["recentAuthors", "prAuthors"] }),
      opts,
    );
    expect(unknown.occupantClass).toBe("unknown");
    expect(unknown.crewBasis).toContain("not available");
    expect(parseLot(metrics(), opts).occupantClass).toBe("none");
    const sampled = classifyCrew(
      metrics({
        ...active,
        recentAuthors: ["alice"],
        authorSample: { prAuthorsInspected: 20, recentCommitsInspected: 15, complete: false },
      }),
      true,
      false,
      opts,
    );
    expect(sampled.crewBasis).toContain("more exist");
  });

  it("marks carried fields as partial instead of presenting them as fresh", () => {
    const lot = parseLot(metrics(), {
      ...opts,
      carried: { fields: ["openIssues"], from: "2026-09-10T00:00:00.000Z" },
    });
    expect(lot.partial).toEqual({
      carriedFields: ["openIssues"],
      carriedFrom: "2026-09-10T00:00:00.000Z",
    });
  });
});

describe("does not hardcode demo repo names", () => {
  it("classifies two different names with identical metrics the same way", () => {
    const a = parseLot(
      metrics({ fullName: "LegadoTeam/legado", owner: "LegadoTeam", name: "legado" }),
      opts,
    );
    const b = parseLot(
      metrics({ fullName: "caillette/Oak", owner: "caillette", name: "Oak" }),
      opts,
    );
    expect(a.yard).toBe(b.yard);
    expect(a.buildingBand).toBe(b.buildingBand);
  });
});
