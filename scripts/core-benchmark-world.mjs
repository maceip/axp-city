/** Reproducible, strictly validated stress town; run with node --import tsx. */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  createWorld,
  cellAt,
  applyCommand,
  BUILDINGS,
  serializeWorld,
  deserializeWorld,
} from "../src/core/index.ts";

export function benchmarkWorld() {
  const world = createWorld(20260919);
  world.buildings = [];
  world.vehicles = [];
  world.nextId = 1;
  for (const cell of world.cells) {
    cell.road = false;
    cell.occupant = null;
  }
  const apply = (command) => {
    const result = applyCommand(world, command);
    if (!result.ok)
      throw new Error(`${JSON.stringify(command)}: ${result.message}`);
  };
  // The eastern dry-land grid leaves the generated river and forest intact.
  for (let y = -30; y <= 30; y++) apply({ type: "road", x: -12, y });
  const streets = Array.from({ length: 12 }, (_, i) => -26 + i * 5);
  for (const y of streets)
    for (let x = -11; x <= 30; x++) apply({ type: "road", x, y });
  for (const x of [-2, 9, 20, 30])
    for (let y = -26; y <= 29; y++) apply({ type: "road", x, y });
  const kinds = ["cottage", "shop", "workshop"];
  for (const [row, y] of streets.entries()) {
    for (const [column, x] of [-10, -6, 0, 5, 11, 16, 22, 26].entries()) {
      const kind = kinds[(row + column) % kinds.length];
      apply({ type: "building", kind, x, y: y - BUILDINGS[kind].depth });
    }
  }
  for (const y of [-26, -11, 4, 19])
    for (const x of [-10, -5, 3, 14, 25]) {
      if (!cellAt(world, x, y)?.road)
        throw new Error("Vehicle spawn must be a road.");
      world.vehicles.push({
        id: `vehicle-${world.nextId++}`,
        x,
        y,
        heading: "e",
        to: null,
        progress: 0,
        route: [],
        goal: null,
        trips: 0,
      });
    }
  world.tick = 0;
  world.revision = 0;
  world.accumulatorMs = 0;
  // Use the production validator in both directions, including occupancy,
  // connected roads, building access and exclusive vehicle reservations.
  return deserializeWorld(serializeWorld(world));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stdout.write(serializeWorld(benchmarkWorld()));
}
