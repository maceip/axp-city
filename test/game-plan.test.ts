import { describe, expect, it } from "vitest";
import { planCityScene, requiredSheets } from "../src/game/plan.js";
import { parseCity } from "../src/parser/index.js";
import { BUILDING_SHEETS, sheetForBand, spriteBoxFor } from "../src/render/sprites.js";
import { FIXED_NOW, metrics } from "./helpers.js";

describe("planCityScene", () => {
  it("plants a building and a dual-plot loading zone on every lot", () => {
    const lots = parseCity(
      [
        metrics({ fullName: "acme/alpha", stars: 100 }),
        metrics({
          fullName: "acme/beta",
          stars: 12_000,
          openPrs: 20,
          pushedAt: "2026-09-10T00:00:00Z",
        }),
      ],
      { now: FIXED_NOW },
    );
    const plan = planCityScene(lots);
    expect(plan.placements).toHaveLength(2);
    expect(plan.hits.map((h) => h.repo)).toEqual(["acme/alpha", "acme/beta"]);
    const buildings = plan.images.filter((s) => s.tag === "building");
    expect(buildings).toHaveLength(2);
    expect(buildings[0]?.sheet).toBe(BUILDING_SHEETS.S.file);
    expect(buildings[1]?.sheet).toBe(BUILDING_SHEETS.M.file);
    const lotTiles = plan.images.filter((s) => s.sheet === "v5-ground-tiles-kit-k1.png" && s.layer === "ground");
    expect(lotTiles.length).toBeGreaterThanOrEqual(2);
  });

  it("dims dormant buildings and keeps their loading zone empty", () => {
    const lots = parseCity(
      [
        metrics({
          fullName: "acme/busy",
          stars: 100,
          openPrs: 20,
          pushedAt: "2026-09-10T00:00:00Z",
          prAuthors: [{ login: "human", type: "User" }],
        }),
        metrics({
          fullName: "acme/planning",
          stars: 100,
          openIssues: 4,
          pushedAt: "2024-01-01T00:00:00Z",
        }),
        metrics({ fullName: "acme/dead", stars: 100 }),
      ],
      { now: FIXED_NOW },
    );
    const plan = planCityScene(lots);
    const dead = plan.images.filter((s) => s.repo === "acme/dead");
    expect(dead.some((s) => s.tag === "building" && s.dimmed)).toBe(true);
    expect(dead.every((s) => s.tag === "building")).toBe(true);
    expect(plan.anims.every((a) => a.repo !== "acme/dead")).toBe(true);

    expect(plan.images.some((s) => s.repo === "acme/busy" && s.sheet === "v2-raw-materials-k1.png")).toBe(
      true,
    );
    expect(plan.anims.some((a) => a.repo === "acme/busy" && a.anim === "unitWalk")).toBe(true);
    expect(plan.anims.some((a) => a.repo === "acme/busy" && a.anim === "cargoDrone")).toBe(true);

    expect(plan.images.some((s) => s.repo === "acme/planning" && s.sheet === "v2-planning-issues-k1.png")).toBe(
      true,
    );
    expect(plan.anims.every((a) => a.repo !== "acme/planning")).toBe(true);
  });

  it("works bot-tended yards with the robot crew, not the human crew", () => {
    const lots = parseCity(
      [
        metrics({
          fullName: "acme/bots",
          stars: 100,
          openPrs: 4,
          openIssues: 2,
          pushedAt: "2026-09-10T00:00:00Z",
          prAuthors: [{ login: "dependabot[bot]", type: "Bot" }],
        }),
      ],
      { now: FIXED_NOW },
    );
    const plan = planCityScene(lots);
    const yard = plan.anims.filter((a) => a.repo === "acme/bots");
    expect(yard.map((a) => a.anim).sort()).toEqual(
      ["cargoDrone", "craneArm", "platformRover", "quadDog"].sort(),
    );
    expect(yard.some((a) => a.anim === "unitWalk")).toBe(false);
    expect(plan.anims.some((a) => !a.repo && a.anim === "unitWalk")).toBe(true);
  });

  it("sizes buildings by band so sheds read smaller than towers", () => {
    const lots = parseCity(
      [
        metrics({ fullName: "acme/shed", stars: 10 }),
        metrics({ fullName: "acme/campus", stars: 12_000 }),
        metrics({ fullName: "acme/tower", stars: 40_000 }),
      ],
      { now: FIXED_NOW },
    );
    const plan = planCityScene(lots);
    const width = (name: string) => {
      const stamp = plan.images.find((s) => s.repo === name && s.tag === "building");
      if (!stamp) throw new Error(name);
      const lot = lots.find((l) => l.fullName === name);
      if (!lot) throw new Error(name);
      return stamp.box.w * stamp.scaleX;
    };
    expect(width("acme/shed")).toBe(112);
    expect(width("acme/campus")).toBe(138);
    expect(width("acme/tower")).toBe(168);
    expect(width("acme/shed")).toBeLessThan(width("acme/campus"));
    expect(width("acme/campus")).toBeLessThan(width("acme/tower"));
  });

  it("stamps real catalog frames and ships those sheets", () => {
    const lots = parseCity([metrics({ fullName: "acme/alpha", stars: 100 })], { now: FIXED_NOW });
    const plan = planCityScene(lots);
    const building = plan.images.find((s) => s.tag === "building");
    expect(building).toBeTruthy();
    const box = spriteBoxFor(lots[0].buildingId);
    expect(building?.box).toEqual(box);
    expect(building?.sheet).toBe(sheetForBand(lots[0].buildingBand).file);
    expect(plan.images.some((s) => s.tag === "wild-tree" || s.tag === "wild-bush")).toBe(true);
    expect(plan.anims.some((a) => a.pace && !a.repo)).toBe(true);
    for (const file of requiredSheets()) {
      expect(file.endsWith(".png")).toBe(true);
    }
  });
});
