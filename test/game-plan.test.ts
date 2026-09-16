import { buildingSize } from "../src/game/geometry.js";
import { describe, expect, it } from "vitest";
import { planLot, requiredSheets } from "../src/game/plan.js";
import { visibleChunks, unproject } from "../src/game/visibility.js";
import { project } from "../src/render/iso.js";
import { parseCity } from "../src/parser/index.js";
import { planCity } from "../src/world/index.js";
import { DEFAULT_RULES } from "../src/rules/cityFiles.js";
import { FIXED_NOW, metrics } from "./helpers.js";
describe("Phaser scene planning", () => {
  it("keeps slender towers within their size band height budget", () => {
    for (let id = 1; id <= 50; id++) {
      const lot = parseCity([metrics({ stars: 30000 })])[0];
      lot.buildingId = id;
      const size = buildingSize(lot);
      expect(size.width).toBeLessThanOrEqual(168.000001);
      expect(size.height).toBeLessThanOrEqual(210.000001);
    }
  });
  it("preserves the shared world addresses and gives every lot its own building and loading zone", () => {
    const places = planCity(
      parseCity(
        Array.from({ length: 1000 }, (_, i) =>
          metrics({ fullName: `acme/r${i}`, stars: i * 100, openPrs: i % 20 }),
        ),
        { now: FIXED_NOW },
      ),
    ).placements;
    const plans = places.map((p) => planLot(p));
    expect(new Set(places.map((p) => `${p.x},${p.y}`)).size).toBe(1000);
    for (let i = 0; i < plans.length; i++) {
      expect(plans[i].hits[0]).toMatchObject({
        repo: places[i].lot.fullName,
        x: places[i].x,
        y: places[i].y,
      });
      expect(plans[i].images.filter((p) => p.tag === "building")).toHaveLength(
        1,
      );
      expect(plans[i].images.some((p) => p.layer === "ground")).toBe(true);
    }
  });
  it("uses the configured sprite sheet even when a repository pins an id from another star band", () => {
    const rules = structuredClone(DEFAULT_RULES);
    rules.building.buildingId = 50;
    rules.building.quietAlpha = 0.3;
    const place = planCity(
      parseCity([metrics({ stars: 10 })], { rules, now: FIXED_NOW }),
    ).placements[0];
    const image = planLot(place).images.find((p) => p.tag === "building")!;
    expect(image.sheet).toBe("buildings-large-35-50-k1.png");
    expect(image.alpha).toBe(0.3);
  });
  it("keeps detailed props and animation out of the flyover and distinguishes humans from robots", () => {
    const places = planCity(
      parseCity(
        [
          metrics({ fullName: "a/human", openPrs: 2, recentDefaultCommits: 1 }),
          metrics({
            fullName: "a/robot",
            openPrs: 2,
            recentDefaultCommits: 1,
            prAuthors: [{ login: "bot", type: "Bot" }],
          }),
        ],
        { now: FIXED_NOW },
      ),
    ).placements;
    expect(planLot(places[0], false).anims).toHaveLength(0);
    expect(
      planLot(places[0], true).anims.some((a) => a.anim === "humanWalk"),
    ).toBe(true);
    expect(
      planLot(places[1], true).anims.some((a) => a.anim === "quadDog"),
    ).toBe(true);
    expect(
      planLot(places[1], true).anims.some((a) => a.anim === "humanWalk"),
    ).toBe(false);
  });
  it("ends construction from its persisted timestamp, including after reload", () => {
    const place = planCity(parseCity([metrics()], { now: FIXED_NOW }))
      .placements[0];
    place.addedAt = FIXED_NOW;
    const start = Date.parse(FIXED_NOW);
    expect(
      planLot(place, true, start + 10_000).images.find(
        (p) => p.tag === "building",
      )?.alpha,
    ).toBe(0.25);
    expect(
      planLot(place, true, start + 46_000).images.find(
        (p) => p.tag === "building",
      )?.alpha,
    ).not.toBe(0.25);
  });
  it("bounds terrain allocation after arbitrarily long camera travel", () => {
    const initial = visibleChunks({ x: 0, y: 0, width: 1600, height: 1000 });
    for (const offset of [-100000, 100000])
      expect(
        visibleChunks({ x: offset, y: offset, width: 1600, height: 1000 })
          .length,
      ).toBeLessThan(initial.length + 10);
    const p = project(-201.5, 340.2);
    expect(unproject(p.sx, p.sy).x).toBeCloseTo(-201.5);
    expect(unproject(p.sx, p.sy).y).toBeCloseTo(340.2);
    expect(new Set(requiredSheets()).size).toBe(requiredSheets().length);
  });
});
