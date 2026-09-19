import {
  BUILDINGS,
  EDGE_TICKS,
  TICK_MS,
  WORLD_SIZE,
  WORLD_VERSION,
  type Point,
  type WorldState,
} from "./types.js";
import { cellAt, connectedRoads, key, same } from "./grid.js";
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid core city save: ${message}`);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}
function point(value: unknown, world: WorldState): value is Point {
  return (
    object(value) &&
    integer(value.x, world.minX, world.minX + world.width - 1) &&
    integer(value.y, world.minY, world.minY + world.height - 1)
  );
}
function validate(input: unknown): asserts input is WorldState {
  requireValue(object(input), "expected an object.");
  requireValue(
    input.version === WORLD_VERSION,
    "unsupported version; an explicit migration is required.",
  );
  requireValue(
    input.width === WORLD_SIZE &&
      input.height === WORLD_SIZE &&
      input.minX === -32 &&
      input.minY === -32,
    "version 1 requires a 64 by 64 map with origin (-32,-32).",
  );
  requireValue(
    integer(input.seed, 0, 0xffffffff),
    "seed must be an unsigned integer.",
  );
  requireValue(
    integer(input.tick, 0, Number.MAX_SAFE_INTEGER),
    "invalid tick.",
  );
  requireValue(
    integer(input.revision, 0, Number.MAX_SAFE_INTEGER),
    "invalid revision.",
  );
  requireValue(
    integer(input.nextId, 1, Number.MAX_SAFE_INTEGER),
    "invalid next id.",
  );
  requireValue(
    typeof input.accumulatorMs === "number" &&
      Number.isFinite(input.accumulatorMs) &&
      input.accumulatorMs >= 0 &&
      input.accumulatorMs < TICK_MS,
    "invalid simulation remainder.",
  );
  requireValue(
    Array.isArray(input.cells) &&
      input.cells.length === WORLD_SIZE * WORLD_SIZE,
    "incorrect cell count.",
  );
  requireValue(
    Array.isArray(input.buildings) &&
      input.buildings.length <= (WORLD_SIZE * WORLD_SIZE) / 4,
    "invalid building list.",
  );
  requireValue(
    Array.isArray(input.vehicles) && input.vehicles.length <= 64,
    "invalid vehicle list.",
  );
  const world = input as unknown as WorldState;
  for (const c of world.cells) {
    requireValue(
      object(c) &&
        ["grass", "dirt", "water"].includes(c.terrain) &&
        c.elevation === 0 &&
        typeof c.road === "boolean" &&
        (c.occupant === null || typeof c.occupant === "string"),
      "invalid terrain cell.",
    );
    requireValue(
      !(c.terrain === "water" && (c.road || c.occupant)),
      "water contains a road or building.",
    );
    requireValue(!(c.road && c.occupant), "road overlaps a building.");
  }
  const ids = new Set<string>(),
    occupancy = new Map<string, string>();
  let largestId = 0;
  function entityId(id: unknown, prefix: string): void {
    requireValue(
      typeof id === "string" && new RegExp(`^${prefix}-[1-9][0-9]*$`).test(id),
      "invalid entity id.",
    );
    const number = Number(id.slice(prefix.length + 1));
    requireValue(
      Number.isSafeInteger(number) && !ids.has(id),
      "duplicate or invalid entity id.",
    );
    ids.add(id);
    largestId = Math.max(largestId, number);
  }
  for (const b of world.buildings) {
    requireValue(
      object(b) &&
        ["cottage", "shop", "workshop"].includes(b.kind) &&
        point(b, world),
      "invalid building.",
    );
    entityId(b.id, "building");
    const def = BUILDINGS[b.kind];
    for (let dy = 0; dy < def.depth; dy++)
      for (let dx = 0; dx < def.width; dx++) {
        const x = b.x + dx,
          y = b.y + dy,
          c = cellAt(world, x, y),
          at = key(x, y);
        requireValue(
          c && !c.road && c.terrain !== "water" && !occupancy.has(at),
          "overlapping or out-of-bounds building footprint.",
        );
        occupancy.set(at, b.id);
      }
    requireValue(
      cellAt(world, b.x + def.access.x, b.y + def.access.y)?.road,
      "building entrance has no road access.",
    );
  }
  world.cells.forEach((c, i) => {
    const at = key(
      world.minX + (i % world.width),
      world.minY + Math.floor(i / world.width),
    );
    requireValue(
      c.occupant === (occupancy.get(at) ?? null),
      "cell occupancy disagrees with building footprints.",
    );
  });
  requireValue(connectedRoads(world), "road network is disconnected.");
  const reserved = new Set<string>();
  for (const v of world.vehicles) {
    requireValue(
      object(v) && point(v, world) && cellAt(world, v.x, v.y)?.road,
      "vehicle is not on a road.",
    );
    entityId(v.id, "vehicle");
    requireValue(
      ["n", "e", "s", "w"].includes(v.heading),
      "invalid vehicle heading.",
    );
    requireValue(
      integer(v.trips, 0, Number.MAX_SAFE_INTEGER),
      "invalid vehicle trip count.",
    );
    requireValue(
      typeof v.progress === "number" &&
        Number.isFinite(v.progress) &&
        v.progress >= 0 &&
        v.progress < 1 &&
        Math.abs(
          v.progress * EDGE_TICKS - Math.round(v.progress * EDGE_TICKS),
        ) < 1e-8,
      "invalid edge progress.",
    );
    requireValue(
      v.to === null || point(v.to, world),
      "invalid vehicle target.",
    );
    requireValue(
      v.goal === null ||
        (point(v.goal, world) && cellAt(world, v.goal.x, v.goal.y)?.road),
      "invalid route destination.",
    );
    requireValue(
      Array.isArray(v.route) && v.route.length <= world.cells.length,
      "invalid route.",
    );
    const source = key(v.x, v.y);
    requireValue(!reserved.has(source), "vehicles share a reserved road tile.");
    reserved.add(source);
    let previous: Point = v;
    if (v.to) {
      requireValue(
        cellAt(world, v.to.x, v.to.y)?.road &&
          Math.abs(v.to.x - v.x) + Math.abs(v.to.y - v.y) === 1,
        "vehicle target is not an adjacent road.",
      );
      const target = key(v.to.x, v.to.y);
      requireValue(
        !reserved.has(target),
        "vehicles share a reserved road tile.",
      );
      reserved.add(target);
      const expected =
        v.to.x > v.x ? "e" : v.to.x < v.x ? "w" : v.to.y > v.y ? "s" : "n";
      requireValue(
        v.heading === expected,
        "vehicle heading disagrees with its edge.",
      );
      previous = v.to;
    } else
      requireValue(v.progress === 0, "stationary vehicle has edge progress.");
    const pathVisited = new Set([key(v.x, v.y), key(previous.x, previous.y)]);
    for (const p of v.route) {
      requireValue(
        point(p, world) &&
          cellAt(world, p.x, p.y)?.road &&
          Math.abs(p.x - previous.x) + Math.abs(p.y - previous.y) === 1,
        "route contains a non-adjacent or non-road step.",
      );
      const at = key(p.x, p.y);
      requireValue(!pathVisited.has(at), "route contains a loop.");
      pathVisited.add(at);
      previous = p;
    }
    requireValue(
      v.goal ? same(previous, v.goal) : !v.to && v.route.length === 0,
      "route does not end at its destination.",
    );
  }
  requireValue(world.nextId > largestId, "next id would reuse an entity id.");
}
export function serializeWorld(world: WorldState): string {
  validate(world);
  return JSON.stringify(world);
}
export function deserializeWorld(text: string): WorldState {
  requireValue(
    typeof text === "string" && text.length <= 2_000_000,
    "save is too large.",
  );
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("Invalid core city save: malformed JSON.");
  }
  validate(input);
  return input;
}
