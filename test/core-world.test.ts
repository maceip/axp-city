import { describe, expect, it } from "vitest";
import {
  advanceWorld,
  applyCommand,
  BUILDINGS,
  cellAt,
  createWorld,
  deserializeWorld,
  findRoute,
  previewCommand,
  roadMask,
  serializeWorld,
  vehiclePose,
  waterMask,
  type Command,
  type WorldState,
} from "../src/core/index.js";

function expectNoOverlap(world: WorldState): void {
  const reservations = new Set<string>();
  const poses = world.vehicles.map((v) => vehiclePose(world, v));
  for (const v of world.vehicles) {
    for (const p of [v, ...(v.to ? [v.to] : [])]) {
      const key = `${p.x},${p.y}`;
      expect(reservations.has(key), `duplicate reservation ${key}`).toBe(false);
      reservations.add(key);
      expect(cellAt(world, p.x, p.y)?.road).toBe(true);
    }
  }
  for (let i = 0; i < poses.length; i++)
    for (let j = i + 1; j < poses.length; j++)
      expect(
        Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y),
      ).toBeGreaterThanOrEqual(0.999999);
}
function editSave(change: (save: any) => void): string {
  const save = JSON.parse(serializeWorld(createWorld(91)));
  change(save);
  return JSON.stringify(save);
}

describe("core city integer grid", () => {
  it("creates the same bounded town for a seed, with coherent water and three building types", () => {
    const world = createWorld(91);
    expect(world).toEqual(createWorld(91));
    expect(world.cells).toHaveLength(4096);
    expect(world.buildings).toHaveLength(12);
    expect(world.vehicles).toHaveLength(3);
    expect(new Set(world.buildings.map((b) => b.kind))).toEqual(
      new Set(["cottage", "shop", "workshop"]),
    );
    expect(world.cells.every((c) => c.elevation === 0)).toBe(true);
    expect(cellAt(world, -32, -32)).toBe(world.cells[0]);
    expect(cellAt(world, 31, 31)).toBe(world.cells[4095]);
    expect(cellAt(world, 32, 0)).toBeUndefined();
    expect(cellAt(world, -32.1, 0)).toBeUndefined();
    const water = world.cells.flatMap((cell, i) =>
      cell.terrain === "water"
        ? [{ x: (i % 64) - 32, y: Math.floor(i / 64) - 32 }]
        : [],
    );
    const seen = new Set([`${water[0].x},${water[0].y}`]),
      queue = [water[0]];
    for (let i = 0; i < queue.length; i++)
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const x = queue[i].x + dx,
          y = queue[i].y + dy,
          key = `${x},${y}`;
        if (seen.has(key) || cellAt(world, x, y)?.terrain !== "water") continue;
        seen.add(key);
        queue.push({ x, y });
      }
    expect(water.length).toBeGreaterThan(200);
    expect(seen.size).toBe(water.length);
    expect(world.cells.map((c) => c.terrain)).not.toEqual(
      createWorld(92).cells.map((c) => c.terrain),
    );
    expect(serializeWorld(deserializeWorld(serializeWorld(world)))).toBe(
      serializeWorld(world),
    );
  });

  it("derives corners, T junctions, crossings and shore edges from neighbor cells", () => {
    const world = createWorld();
    expect(roadMask(world, -10, -6)).toBe(2 | 4);
    expect(roadMask(world, 0, -6)).toBe(2 | 4 | 8);
    expect(roadMask(world, 0, 0)).toBe(15);
    expect(roadMask(world, -8, -8)).toBe(0);
    for (let y = 20; y < 24; y++)
      for (let x = 20; x < 24; x++) cellAt(world, x, y)!.terrain = "grass";
    cellAt(world, 21, 21)!.terrain = "water";
    cellAt(world, 21, 20)!.terrain = "water";
    cellAt(world, 22, 21)!.terrain = "water";
    expect(waterMask(world, 21, 21)).toBe(1 | 2);
    expect(waterMask(world, 20, 21)).toBe(0);
  });

  it("previews and applies atomic footprint commands with a real entrance road", () => {
    const world = createWorld();
    const command: Command = {
      type: "building",
      kind: "cottage",
      x: -12,
      y: -2,
    };
    const original = serializeWorld(world);
    expect(previewCommand(world, command).ok).toBe(false);
    expect(applyCommand(world, command).ok).toBe(false);
    expect(serializeWorld(world)).toBe(original);
    expect(applyCommand(world, { type: "road", x: -11, y: 0 }).ok).toBe(true);
    expect(applyCommand(world, { type: "road", x: -12, y: 0 }).ok).toBe(true);
    const before = serializeWorld(world);
    expect(previewCommand(world, command).ok).toBe(true);
    expect(serializeWorld(world)).toBe(before);
    expect(applyCommand(world, command).ok).toBe(true);
    const b = world.buildings.at(-1)!;
    for (let y = -2; y < 0; y++)
      for (let x = -12; x < -10; x++)
        expect(cellAt(world, x, y)?.occupant).toBe(b.id);
    expect(applyCommand(world, { type: "bulldoze", x: -12, y: 0 }).ok).toBe(
      false,
    );
    expect(applyCommand(world, { type: "bulldoze", x: -11, y: -1 }).ok).toBe(
      true,
    );
    expect(world.buildings.some((other) => other.id === b.id)).toBe(false);
    expect(world.cells.some((c) => c.occupant === b.id)).toBe(false);
    expect(applyCommand(world, { type: "bulldoze", x: -12, y: 0 }).ok).toBe(
      true,
    );
    expect(deserializeWorld(serializeWorld(world))).toEqual(world);
  });

  it("rejects water, overlaps, bounds, orphan roads, occupied roads and network cuts", () => {
    const world = createWorld();
    expect(applyCommand(world, { type: "road", x: 25, y: 25 }).ok).toBe(false);
    expect(
      applyCommand(world, { type: "building", kind: "shop", x: -1, y: -1 }).ok,
    ).toBe(false);
    expect(
      applyCommand(world, { type: "building", kind: "shop", x: 31, y: 31 }).ok,
    ).toBe(false);
    expect(
      applyCommand(world, { type: "building", kind: "shop", x: -8, y: -8 }).ok,
    ).toBe(false);
    expect(applyCommand(world, { type: "road", x: NaN, y: 0 }).ok).toBe(false);
    const i = world.cells.findIndex((c) => c.terrain === "water");
    expect(
      applyCommand(world, {
        type: "road",
        x: (i % 64) - 32,
        y: Math.floor(i / 64) - 32,
      }).ok,
    ).toBe(false);
    expect(applyCommand(world, { type: "bulldoze", x: -9, y: -6 }).ok).toBe(
      false,
    );
    expect(applyCommand(world, { type: "bulldoze", x: -8, y: -6 }).ok).toBe(
      false,
    );
    expect(applyCommand(world, { type: "road", x: -11, y: 0 }).ok).toBe(true);
    expect(applyCommand(world, { type: "road", x: -12, y: 0 }).ok).toBe(true);
    expect(applyCommand(world, { type: "bulldoze", x: -11, y: 0 }).ok).toBe(
      false,
    );
    expect(applyCommand(world, { type: "bulldoze", x: -12, y: 0 }).ok).toBe(
      true,
    );
  });

  it("routes only through adjacent road tiles and obeys blocked nodes", () => {
    const world = createWorld(),
      from = { x: -10, y: 0 },
      to = { x: 10, y: 0 };
    const route = findRoute(world, from, to)!;
    expect(route).toHaveLength(20);
    expect(route.at(-1)).toEqual(to);
    expect(
      findRoute(world, from, to, new Set(["0,0"]))!.length,
    ).toBeGreaterThan(20);
    expect(findRoute(world, from, { x: 4, y: 4 })).toBeNull();
  });
});

describe("core city fixed simulation and saves", () => {
  it("interpolates reserved edges smoothly without mutating simulation state", () => {
    const world = createWorld(22);
    advanceWorld(world, 100);
    const before = serializeWorld(world);
    const vehicle = world.vehicles[0];
    const a = vehiclePose(world, vehicle);
    expect(serializeWorld(world)).toBe(before);
    advanceWorld(world, 50);
    const b = vehiclePose(world, vehicle);
    expect(world.tick).toBe(1);
    expect(vehicle.progress).toBe(0);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(0.05);
    for (let i = 0; i < 2000; i++) {
      advanceWorld(world, 37);
      expectNoOverlap(world);
    }
  });

  it("can save and resume at every tick including blocked routes and trip boundaries", () => {
    let world = createWorld(883);
    for (let i = 0; i < 1800; i++) {
      advanceWorld(world, 100);
      const encoded = serializeWorld(world);
      if (i % 17 === 0) world = deserializeWorld(encoded);
    }
    expect(world.tick).toBe(1800);
    expect(world.vehicles.every((v) => v.trips > 0)).toBe(true);
  });
  it("does not accumulate clock drift at fractional 60Hz or 144Hz frame times", () => {
    const reference = createWorld(22),
      sixty = createWorld(22),
      fast = createWorld(22);
    advanceWorld(reference, 60_000);
    for (let i = 0; i < 3600; i++) advanceWorld(sixty, 1000 / 60);
    for (let i = 0; i < 8640; i++) advanceWorld(fast, 1000 / 144);
    expect(sixty).toEqual(reference);
    expect(fast).toEqual(reference);
  });
  it("is independent of elapsed-time chunking and keeps vehicles separated through turns", () => {
    const a = createWorld(22),
      b = createWorld(22);
    advanceWorld(a, 60_000);
    for (let i = 0; i < 2400; i++) advanceWorld(b, 25);
    expect(a).toEqual(b);
    expect(a.tick).toBe(600);
    expect(a.vehicles.some((v) => v.trips > 0)).toBe(true);
    for (let i = 0; i < 1000; i++) {
      advanceWorld(a, 100);
      expectNoOverlap(a);
    }
    expect(() => advanceWorld(a, Infinity)).toThrow();
    expect(() => advanceWorld(a, -1)).toThrow();
  });

  it("resumes the exact clock, destinations and edge progress from a save", () => {
    const a = createWorld(42);
    advanceWorld(a, 12_345);
    const b = deserializeWorld(serializeWorld(a));
    expect(b.accumulatorMs).toBe(45);
    advanceWorld(a, 44_455);
    for (let i = 0; i < 444; i++) advanceWorld(b, 100);
    advanceWorld(b, 55);
    expect(serializeWorld(a)).toBe(serializeWorld(b));
    for (const building of b.buildings) {
      const access = BUILDINGS[building.kind].access;
      expect(
        cellAt(b, building.x + access.x, building.y + access.y)?.road,
      ).toBe(true);
    }
  });

  it("invalidates derived paths safely after removing an unoccupied road", () => {
    const world = createWorld(42);
    advanceWorld(world, 350);
    let removed = false;
    for (let y = -6; y <= 6 && !removed; y++)
      for (let x = -10; x <= 10 && !removed; x++) {
        if (!cellAt(world, x, y)?.road) continue;
        removed = applyCommand(world, { type: "bulldoze", x, y }).ok;
      }
    expect(removed).toBe(true);
    expect(() => serializeWorld(world)).not.toThrow();
    for (let i = 0; i < 200; i++) {
      advanceWorld(world, 100);
      expectNoOverlap(world);
    }
    expect(() => serializeWorld(world)).not.toThrow();
  });

  it.each([
    [
      "unknown version",
      (s: any) => {
        s.version = 2;
      },
    ],
    [
      "oversized dimensions",
      (s: any) => {
        s.width = 1_000_000;
      },
    ],
    [
      "wrong cell count",
      (s: any) => {
        s.cells.pop();
      },
    ],
    [
      "invalid clock",
      (s: any) => {
        s.tick = null;
      },
    ],
    [
      "invalid remainder",
      (s: any) => {
        s.accumulatorMs = 100;
      },
    ],
    [
      "invalid height",
      (s: any) => {
        s.cells[0].elevation = 1;
      },
    ],
    [
      "orphan occupancy",
      (s: any) => {
        s.cells[0].occupant = "building-999";
      },
    ],
    [
      "duplicate building",
      (s: any) => {
        s.buildings.push(s.buildings[0]);
      },
    ],
    [
      "duplicate vehicle",
      (s: any) => {
        s.vehicles.push(s.vehicles[0]);
      },
    ],
    [
      "nonfinite coordinate",
      (s: any) => {
        s.vehicles[0].x = null;
      },
    ],
    [
      "reused next id",
      (s: any) => {
        s.nextId = 1;
      },
    ],
    [
      "bad route",
      (s: any) => {
        s.vehicles[0].route = [{ x: 10, y: 6 }];
        s.vehicles[0].goal = { x: 10, y: 6 };
      },
    ],
    [
      "vehicle overlap",
      (s: any) => {
        s.vehicles[1].x = s.vehicles[0].x;
        s.vehicles[1].y = s.vehicles[0].y;
      },
    ],
    [
      "missing access",
      (s: any) => {
        s.cells[(-6 + 32) * 64 + (-8 + 32)].road = false;
      },
    ],
  ])("rejects malformed saves: %s", (_name, change) => {
    expect(() => deserializeWorld(editSave(change))).toThrow(
      "Invalid core city save",
    );
  });
  it("rejects invalid JSON and non-finite live state before saving", () => {
    expect(() => deserializeWorld("{")).toThrow("malformed JSON");
    const world = createWorld();
    world.vehicles[0].progress = NaN;
    expect(() => serializeWorld(world)).toThrow("Invalid core city save");
  });
});
