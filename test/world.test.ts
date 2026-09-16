import { describe, expect, it } from "vitest";
import { parseCity } from "../src/parser/index.js";
import { parseLot } from "../src/parser/parseLot.js";
import {
  CONSTRUCTION_MS,
  isReservedSlot,
  lotSlot,
  nextCadenceSlot,
  planCity,
  tileKind,
} from "../src/world/index.js";
import { isDailyDistrict, isMonthlyDistrict, isWeeklyDistrict } from "../src/world/trending.js";
import { FIXED_NOW, metrics } from "./helpers.js";

function lots(n: number) {
  return parseCity(
    Array.from({ length: n }, (_, i) =>
      metrics({ fullName: `acme/r${i}`, owner: "acme", name: `r${i}`, stars: 100 + i }),
    ),
    { now: FIXED_NOW },
  );
}

describe("lotSlot", () => {
  it("never lands on reserved park, freeway, tram, or river cells", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const slot = lotSlot(i);
      expect(isReservedSlot(slot.sx, slot.sy), `${slot.sx},${slot.sy}`).toBe(false);
      const key = `${slot.sx},${slot.sy}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("is sticky: adding later lots does not move earlier addresses", () => {
    const a = lots(4).map((_, i) => lotSlot(i));
    const b = lots(12).map((_, i) => lotSlot(i));
    for (let i = 0; i < 4; i++) {
      expect(b[i]).toEqual(a[i]);
    }
  });
});

describe("planCity", () => {
  it("always reserves central park, freeway, tram, and river", () => {
    const plan = planCity(lots(1));
    const kinds = plan.features.map((f) => f.kind);
    expect(kinds).toContain("park");
    expect(kinds).toContain("freeway");
    expect(kinds).toContain("tram");
    expect(kinds).toContain("river");
    const park = plan.features.find((f) => f.kind === "park");
    expect(park?.id).toBe("central-park");
    expect(park!.w).toBeGreaterThan(4);
    expect(park!.h).toBeGreaterThan(4);
  });

  it("places a distinct center office, bike lanes, plants, and occasional odd buildings", () => {
    const plan = planCity(lots(24));
    expect(plan.features.some((f) => f.kind === "office" && f.id === "city-office")).toBe(true);
    expect(plan.features.some((f) => f.kind === "bike")).toBe(true);
    const office = plan.civics.find((c) => c.kind === "office");
    expect(office?.sprite).toBe("office");
    expect(plan.civics.filter((c) => c.kind === "plant").length).toBeGreaterThan(4);
    expect(plan.civics.some((c) => c.kind === "odd")).toBe(true);
    expect(plan.civics.some((c) => c.kind === "gate")).toBe(true);
    expect(plan.civics.filter((c) => c.kind === "road").length).toBeGreaterThan(3);
    expect(plan.civics.filter((c) => c.kind === "bike").length).toBeGreaterThan(3);
    expect(plan.civics.every((c) => c.kind !== "road" || c.sprite.startsWith("road-"))).toBe(true);
    expect(plan.civics.every((c) => c.kind !== "bike" || c.sprite.startsWith("bike-"))).toBe(true);
    expect(planCity(lots(36)).civics.some((c) => c.kind === "odd")).toBe(true);
    const park = plan.features.find((f) => f.kind === "park")!;
    expect(office!.x).toBeGreaterThan(park.x);
    expect(office!.x).toBeLessThan(park.x + park.w);
    expect(plan.placements.every((p) => p.lot.fullName !== "city-office")).toBe(true);
  });

  it("paints bike lanes on the street shoulder without shuffling lot addresses", () => {
    const small = planCity(lots(4));
    const large = planCity(lots(24));
    expect(small.placements[0].x).toBe(large.placements[0].x);
    expect(small.placements[0].y).toBe(large.placements[0].y);
    const street = large.placements[0];
    expect(tileKind(street.x, street.y + 2.85, large)).toBe("bike");
  });

  it("grows freeway and tram with the lot set, without moving plots", () => {
    const small = planCity(lots(4));
    const large = planCity(lots(24));
    const fwS = small.features.find((f) => f.kind === "freeway")!;
    const fwL = large.features.find((f) => f.kind === "freeway")!;
    const trS = small.features.find((f) => f.kind === "tram")!;
    const trL = large.features.find((f) => f.kind === "tram")!;
    expect(fwL.w).toBeGreaterThan(fwS.w);
    expect(trL.h).toBeGreaterThan(trS.h);
    expect(large.placements[0].x).toBe(small.placements[0].x);
    expect(large.placements[0].y).toBe(small.placements[0].y);
    expect(large.placements[0].lot.fullName).toBe("acme/r0");
  });

  it("fills vacant plots inside the developed bbox so the city is more than a repo grid", () => {
    const plan = planCity(lots(8));
    expect(plan.vacancies.length).toBeGreaterThan(0);
    const occupied = new Set(plan.placements.map((p) => `${p.col},${p.row}`));
    for (const v of plan.vacancies) {
      expect(occupied.has(`${v.sx},${v.sy}`)).toBe(false);
      expect(isReservedSlot(v.sx, v.sy)).toBe(false);
    }
  });

  it("marks only young lots as constructing", () => {
    const city = lots(3);
    const plan = planCity(city, {
      now: "2026-09-16T00:00:00.000Z",
      addedAt: {
        "acme/r0": "2020-01-01T00:00:00.000Z",
        "acme/r2": "2026-09-16T00:00:20.000Z",
      },
    });
    expect(plan.placements[0].constructing).toBe(false);
    expect(plan.placements[2].constructing).toBe(true);
    expect(CONSTRUCTION_MS).toBeGreaterThan(20_000);
  });
});

describe("tileKind", () => {
  it("keeps developed features inside the plan and wilderness outside", () => {
    const plan = planCity(lots(8));
    const park = plan.features.find((f) => f.kind === "park")!;
    expect(tileKind(park.x + 1, park.y + 1, plan)).toBe("park");
    const far = tileKind(plan.bounds.maxX + 40, plan.bounds.maxY + 40, plan);
    expect(["grass", "dirt", "trees", "water"]).toContain(far);
  });

  it("is stable for the same coordinates", () => {
    const plan = planCity(lots(8));
    expect(tileKind(80, 80, plan)).toBe(tileKind(80, 80, plan));
  });
});

describe("Trending City districts", () => {
  it("assigns daily, weekly, and monthly lots to separate streets and keeps addresses", () => {
    const city = [
      parseLot(metrics({ fullName: "trend/daily-a", owner: "trend", name: "daily-a" }), {
        now: FIXED_NOW,
        cadence: "daily",
      }),
      parseLot(metrics({ fullName: "trend/weekly-a", owner: "trend", name: "weekly-a" }), {
        now: FIXED_NOW,
        cadence: "weekly",
      }),
      parseLot(metrics({ fullName: "trend/monthly-a", owner: "trend", name: "monthly-a" }), {
        now: FIXED_NOW,
        cadence: "monthly",
      }),
    ];
    const first = planCity(city);
    expect(first.placements.map((p) => p.district)).toEqual([
      "Daily Projects",
      "Weekly Projects",
      "Monthly Projects",
    ]);
    expect(isDailyDistrict(first.placements[0].col, first.placements[0].row)).toBe(true);
    expect(isWeeklyDistrict(first.placements[1].col, first.placements[1].row)).toBe(true);
    expect(isMonthlyDistrict(first.placements[2].col, first.placements[2].row)).toBe(true);
    expect(first.labels.map((l) => l.text)).toEqual([
      "DAILY PROJECTS",
      "WEEKLY PROJECTS",
      "MONTHLY PROJECTS",
    ]);
    const grown = planCity([
      ...city,
      parseLot(metrics({ fullName: "trend/daily-b", owner: "trend", name: "daily-b" }), {
        now: FIXED_NOW,
        cadence: "daily",
      }),
    ]);
    expect(grown.placements[0].col).toBe(first.placements[0].col);
    expect(grown.placements[0].row).toBe(first.placements[0].row);
    expect(grown.placements[3].district).toBe("Daily Projects");
    const occupied = new Set(first.placements.map((p) => `${p.col},${p.row}`));
    const next = nextCadenceSlot("daily", occupied);
    expect(isDailyDistrict(next.col, next.row)).toBe(true);
  });
});
