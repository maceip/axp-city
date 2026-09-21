import { applyCommand } from "./commands.js";
import { cellAt } from "./grid.js";
import { mix } from "./simulation.js";
import {
  WORLD_SIZE,
  WORLD_VERSION,
  type BuildingKind,
  type WorldState,
} from "./types.js";
export function createWorld(seed = 20260919): WorldState {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("Seed must be an unsigned 32-bit integer.");
  const phase = (mix(seed, 31) / 0xffffffff) * Math.PI * 2;
  const world: WorldState = {
    version: WORLD_VERSION,
    seed,
    width: WORLD_SIZE,
    height: WORLD_SIZE,
    minX: -32,
    minY: -32,
    tick: 0,
    revision: 0,
    accumulatorMs: 0,
    cells: [],
    buildings: [],
    vehicles: [],
    nextId: 1,
  };
  for (let y = -32; y < 32; y++)
    for (let x = -32; x < 32; x++) {
      const riverCenter = -18 + Math.sin(y * 0.12 + phase) * 1.9;
      const riverDistance = Math.abs(x - riverCenter);
      const lakeDistance = Math.hypot((x + 19) / 1.25, y - 13);
      const water = riverDistance < 1.9 || lakeDistance < 5.2;
      const bank = riverDistance < 2.9 || lakeDistance < 6.2;
      const dirtPatch =
        Math.hypot((x - 18) / 1.5, y - 16) <
        3.4 + Math.sin(x * 0.5 + phase) * 0.5;
      world.cells.push({
        terrain: water ? "water" : bank || dirtPatch ? "dirt" : "grass",
        elevation: 0,
        road: false,
        occupant: null,
      });
    }
  // A connected grid with corners, T junctions, a four-way crossing and room to grow.
  for (let x = -10; x <= 10; x++)
    for (const y of [-6, 0, 6]) cellAt(world, x, y)!.road = true;
  for (let y = -6; y <= 6; y++)
    for (const x of [-10, 0, 10]) cellAt(world, x, y)!.road = true;
  const buildings: Array<[BuildingKind, number, number]> = [
    ["cottage", -8, -8],
    ["shop", -4, -8],
    ["workshop", 2, -9],
    ["cottage", 7, -8],
    ["workshop", -8, -3],
    ["cottage", -4, -2],
    ["shop", 2, -2],
    ["cottage", 7, -2],
    ["shop", -8, 4],
    ["workshop", -4, 3],
    ["cottage", 2, 4],
    ["workshop", 6, 3],
  ];
  for (const [kind, x, y] of buildings) {
    const result = applyCommand(world, { type: "building", kind, x, y });
    if (!result.ok) throw new Error(`Invalid initial city: ${result.message}`);
  }
  for (const [x, y, heading] of [
    [-9, -6, "e"],
    [9, 6, "w"],
    [0, 1, "n"],
  ] as const) {
    world.vehicles.push({
      id: `vehicle-${world.nextId++}`,
      x,
      y,
      heading,
      to: null,
      progress: 0,
      route: [],
      goal: null,
      trips: 0,
    });
  }
  world.revision = 0;
  return world;
}
