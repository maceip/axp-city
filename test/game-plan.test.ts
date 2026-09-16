import { buildingBounds, buildingSize, lotSampleBounds } from "../src/game/geometry.js";
import { describe, expect, it } from "vitest";
import { planLot, requiredSheets } from "../src/game/plan.js";
import { ambientActors, pointAlong } from "../src/game/ambient.js";
import { censusRows, filterCensus, findPlacement, massPercent, sortCensus } from "../src/game/census.js";
import { constructionLabel, constructionState } from "../src/game/construction.js";
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
  it("samples the lot diamond and building foot, not the full L-tower union", () => {
    const place = planCity(
      parseCity([metrics({ fullName: "acme/forge", stars: 25000 })], { now: FIXED_NOW }),
    ).placements[0];
    place.lot.buildingId = 42;
    place.lot.buildingBand = "L";
    const tower = buildingBounds(place);
    const sample = lotSampleBounds(place);
    const diamondH =
      project(place.x + 4, place.y + 2.4).sy - project(place.x, place.y).sy;
    expect(sample.height).toBeLessThan(tower.height);
    expect(sample.height).toBeLessThan(diamondH * 2.2);
    expect(sample.y).toBeGreaterThan(tower.y);
    expect(diamondH / sample.height).toBeGreaterThan(0.45);
    expect(sample.width).toBeGreaterThan(diamondH);
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
  it("renders full detail at every zoom and gives human, robot and mixed crews distinct behaviours", () => {
    const places = planCity(
      parseCity(
        [
          metrics({ fullName: "a/human", openPrs: 2, recentDefaultCommits: 1, recentAuthors: ["ada"] }),
          metrics({
            fullName: "a/robot",
            openPrs: 2,
            recentDefaultCommits: 1,
            recentAuthors: ["dependabot[bot]"],
            prAuthors: [{ login: "bot", type: "Bot" }],
          }),
          metrics({
            fullName: "a/mixed",
            openPrs: 2,
            recentDefaultCommits: 2,
            recentAuthors: ["ada", "renovate[bot]"],
          }),
        ],
        { now: FIXED_NOW },
      ),
    ).placements;
    // The live scene never calls planLot with detail=false; every lot keeps its yard and actors.
    const human = planLot(places[0]);
    const behaviours = new Set(human.anims.map((a) => a.behaviour));
    expect(behaviours).toEqual(new Set(["walk", "carry", "wave"]));
    expect(human.anims.every((a) => a.anim.startsWith("human") || a.anim === "cargoDrone")).toBe(true);
    expect(new Set(human.anims.map((a) => a.actorId)).size).toBe(human.anims.length);
    const robot = planLot(places[1]);
    expect(robot.anims.some((a) => a.anim === "quadDog")).toBe(true);
    expect(robot.anims.some((a) => a.anim.startsWith("human"))).toBe(false);
    const mixed = planLot(places[2]);
    expect(mixed.anims.some((a) => a.anim.startsWith("human"))).toBe(true);
    expect(mixed.anims.some((a) => !a.anim.startsWith("human") && a.anim !== "cargoDrone")).toBe(true);
  });
  it("stages construction from the persisted timestamp so every visitor sees the same progress", () => {
    const place = planCity(
      parseCity([metrics({ stars: 30000, recentDefaultCommits: 1, recentAuthors: ["ada"] })], { now: FIXED_NOW }),
    ).placements[0];
    place.addedAt = FIXED_NOW;
    const start = Date.parse(FIXED_NOW);
    const at = (ms: number) => planLot(place, true, start + ms);
    const grading = at(2_000);
    expect(grading.construction?.stage).toBe("grading");
    expect(grading.images.filter((i) => i.tag?.startsWith("cone:"))).toHaveLength(3);
    expect(grading.images.find((i) => i.tag === "building")?.alpha).toBe(0);
    expect(grading.anims.some((a) => a.anim === "craneArm")).toBe(false);
    const framing = at(12_000);
    expect(framing.construction?.stage).toBe("framing");
    expect(framing.construction?.scaffold).toBeGreaterThan(0);
    expect(framing.anims.some((a) => a.anim === "craneArm")).toBe(true);
    const cladding = at(30_000);
    expect(cladding.construction?.stage).toBe("cladding");
    expect(cladding.images.find((i) => i.tag === "building")?.alpha).toBeGreaterThan(0.12);
    expect(cladding.images.find((i) => i.tag === "building")?.alpha).toBeLessThan(0.8);
    const finishing = at(40_000);
    expect(finishing.construction?.stage).toBe("finishing");
    expect(finishing.anims.some((a) => a.anim === "craneArm")).toBe(false);
    expect(finishing.images.some((i) => i.tag?.startsWith("cone:"))).toBe(false);
    expect(finishing.images.some((i) => i.tag === "scaffold-art")).toBe(true);
    const done = at(46_000);
    expect(done.construction).toBeUndefined();
    expect(done.images.find((i) => i.tag === "building")?.alpha).toBe(1);
    expect(constructionState(place, start + 46_000).stage).toBe("complete");
    expect(constructionLabel(constructionState(place, start + 12_000))).toBe("Raising the frame");
  });
  it("renders version-2 rules: bays, explicit slots, decor props and approved artwork", () => {
    const place = planCity(
      parseCity([metrics({ fullName: "a/v2", openPrs: 3, recentDefaultCommits: 1 })], { now: FIXED_NOW }),
    ).placements[0];
    const base = planLot(place);
    place.lot.layout = { bays: 3, slots: [{ prop: "materials", x: 0.9, y: 1.1 }] };
    place.lot.extraProps = ["cones", "lamp", "bench"];
    const custom = planLot(place);
    expect(custom.images.filter((i) => i.tag?.startsWith("bay:"))).toHaveLength(2);
    expect(custom.images.some((i) => i.tag === "loading-apron")).toBe(true);
    expect(custom.diamonds.length).toBeGreaterThan(base.diamonds.length);
    expect(custom.images.filter((i) => i.tag?.startsWith("decor:")).map((i) => i.tag)).toEqual([
      "decor:cones",
      "decor:lamp",
      "decor:bench",
    ]);
    const materials = (plan: typeof base) =>
      plan.images.find((i) => i.sheet === "v2-raw-materials-k1.png" && !i.tag);
    expect(materials(custom)!.sx).not.toBe(materials(base)!.sx);
    place.lot.artwork = { sha256: "ab".repeat(32), width: 200, height: 260, url: "/assets/artwork/abab.png" };
    const art = planLot(place).images.find((i) => i.tag === "building")!;
    expect(art.sheet).toBe(`artwork:${"ab".repeat(32)}`);
    expect(art.url).toBe("/assets/artwork/abab.png");
    expect(art.box).toEqual({ x: 0, y: 0, w: 200, h: 260 });
    expect(art.box.w * art.scaleX).toBeLessThanOrEqual(168.0001);
  });
  it("derives freeway traffic, a tram that stops at Park Station, and park pedestrians from the plan", () => {
    const plan = planCity(
      parseCity(
        Array.from({ length: 12 }, (_, i) => metrics({ fullName: `acme/r${i}` })),
        { now: FIXED_NOW },
      ),
    );
    const actors = ambientActors(plan);
    const cars = actors.filter((a) => a.kind === "car");
    const freeway = plan.features.find((f) => f.kind === "freeway")!;
    expect(cars.length).toBeGreaterThanOrEqual(4);
    for (const car of cars) {
      for (const p of car.path) {
        expect(p.y).toBeGreaterThan(freeway.y);
        expect(p.y).toBeLessThan(freeway.y + freeway.h);
      }
      expect(car.motion).toBe("wrap");
    }
    expect(new Set(cars.map((c) => c.path[0].x > c.path[1].x)).size).toBe(2);
    const tram = actors.find((a) => a.kind === "tram")!;
    const plaza = plan.features.find((f) => f.kind === "plaza")!;
    const stop = pointAlong(tram.path, tram.stops!.at[0]);
    expect(stop.y).toBeCloseTo(plaza.y + plaza.h / 2, 1);
    expect(tram.motion).toBe("yoyo");
    const park = plan.features.find((f) => f.kind === "park")!;
    const people = actors.filter((a) => a.kind === "pedestrian");
    expect(people.map((p) => p.anim)).toEqual(expect.arrayContaining(["humanWalk", "humanWave", "humanWork"]));
    for (const person of people)
      for (const p of person.path) {
        expect(p.x).toBeGreaterThanOrEqual(park.x);
        expect(p.x).toBeLessThanOrEqual(park.x + park.w);
        expect(p.y).toBeGreaterThanOrEqual(park.y);
        expect(p.y).toBeLessThanOrEqual(park.y + park.h);
      }
    expect(new Set(actors.map((a) => a.id)).size).toBe(actors.length);
  });
  it("builds the census and MASS bar from the same lots the scene draws", () => {
    const plan = planCity(
      parseCity(
        [
          metrics({ fullName: "acme/big", stars: 40000, openPrs: 3, recentDefaultCommits: 1, recentAuthors: ["ada"] }),
          metrics({ fullName: "acme/small", stars: 10 }),
        ],
        { now: FIXED_NOW },
      ),
    );
    const rows = censusRows(plan, Date.parse(FIXED_NOW));
    expect(rows.map((r) => r.repo)).toEqual(["acme/big", "acme/small"]);
    expect(rows[0]).toMatchObject({ band: "L", crew: "HUMAN CREW", prs: 3 });
    expect(rows[1]).toMatchObject({ band: "S", crew: "QUIET LOT", props: "—" });
    expect(massPercent("L")).toBe(100);
    expect(massPercent(undefined)).toBe(0);
    expect(sortCensus(rows, "stars", true)[0].repo).toBe("acme/big");
    expect(filterCensus(rows, "SMALL").map((r) => r.repo)).toEqual(["acme/small"]);
    expect(findPlacement(plan, "big")?.lot.fullName).toBe("acme/big");
    expect(findPlacement(plan, "ACME/SMALL")?.lot.fullName).toBe("acme/small");
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
    expect(requiredSheets()).toContain("civic-kit-k1.png");
    expect(requiredSheets()).toContain("hud-kit-k1.png");
  });
  it("tints repo facades and stamps dressing plus construction art from the civic kit", () => {
    const places = planCity(
      parseCity(
        [
          metrics({ fullName: "acme/tint-a", stars: 12 }),
          metrics({ fullName: "acme/tint-b", stars: 12 }),
        ],
        { now: FIXED_NOW },
      ),
    ).placements;
    const a = planLot(places[0]).images.find((i) => i.tag === "building")!;
    const b = planLot(places[1]).images.find((i) => i.tag === "building")!;
    expect(a.tint).toBe(places[0].lot.facadeTint);
    expect(b.tint).toBe(places[1].lot.facadeTint);
    const dressed = places.find((p) => p.lot.dressingProp !== "none") ?? places[0];
    if (dressed.lot.dressingProp !== "none") {
      expect(planLot(dressed).images.some((i) => i.tag === `dressing:${dressed.lot.dressingProp}`)).toBe(true);
    }
    const site = planCity(
      parseCity([metrics({ fullName: "acme/new", stars: 30000 })], { now: FIXED_NOW }),
      { now: FIXED_NOW, addedAt: { "acme/new": FIXED_NOW } },
    ).placements[0];
    const grading = planLot(site, true, Date.parse(FIXED_NOW) + 2_000);
    expect(grading.construction?.stage).toBe("grading");
    expect(grading.images.some((i) => i.tag === "scaffold-art" && i.sheet === "civic-kit-k1.png")).toBe(true);
  });
});
