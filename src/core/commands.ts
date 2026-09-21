import {
  BUILDINGS,
  DIRECTIONS,
  type BuildingKind,
  type Command,
  type CommandResult,
  type WorldState,
} from "./types.js";
import { cellAt, connectedRoads, roadCells, same } from "./grid.js";
const ok = (message: string): CommandResult => ({ ok: true, message });
const no = (message: string): CommandResult => ({ ok: false, message });
export function previewCommand(
  world: WorldState,
  command: Command,
): CommandResult {
  if (
    !command ||
    typeof command !== "object" ||
    !["road", "building", "bulldoze"].includes(command.type)
  )
    return no("Choose a valid building tool.");
  const { x, y } = command,
    cell = cellAt(world, x, y);
  if (!cell) return no("Choose a tile inside the map.");
  if (command.type === "building") {
    if (!["cottage", "shop", "workshop"].includes(command.kind))
      return no("Unknown building type.");
    const def = BUILDINGS[command.kind];
    for (let dy = 0; dy < def.depth; dy++)
      for (let dx = 0; dx < def.width; dx++) {
        const at = cellAt(world, x + dx, y + dy);
        if (!at) return no("The full building must fit inside the map.");
        if (at.terrain === "water") return no("Buildings need dry land.");
        if (at.road) return no("The building would cover a road.");
        if (at.occupant) return no("Another building occupies this footprint.");
      }
    if (!cellAt(world, x + def.access.x, y + def.access.y)?.road)
      return no("Connect a road to the entrance on the south edge.");
    return ok(`Place ${def.name.toLowerCase()}.`);
  }
  if (command.type === "road") {
    if (cell.road) return ok("Road already exists.");
    if (cell.terrain === "water")
      return no("Roads need dry land; bridges are not available.");
    if (cell.occupant) return no("Remove the building before placing a road.");
    if (
      roadCells(world).length &&
      !DIRECTIONS.some((d) => cellAt(world, x + d.x, y + d.y)?.road)
    )
      return no("Extend a road from the existing street network.");
    return ok("Place road.");
  }
  if (cell.occupant) return ok("Remove the whole building.");
  if (!cell.road) return no("There is nothing to remove on this tile.");
  if (
    world.vehicles.some(
      (v) => same(v, command) || (v.to && same(v.to, command)),
    )
  )
    return no("Wait for the vehicle to clear this road.");
  if (
    world.buildings.some((b) => {
      const access = BUILDINGS[b.kind].access;
      return b.x + access.x === x && b.y + access.y === y;
    })
  )
    return no(
      "This road serves a building entrance. Remove that building first.",
    );
  if (!connectedRoads(world, command))
    return no("Removing this road would split the street network.");
  return ok("Remove road.");
}
export function applyCommand(
  world: WorldState,
  command: Command,
): CommandResult {
  const result = previewCommand(world, command);
  if (!result.ok) return result;
  const { x, y } = command,
    cell = cellAt(world, x, y)!;
  if (command.type === "road") {
    if (cell.road) return result;
    cell.road = true;
  } else if (command.type === "building") {
    const id = `building-${world.nextId++}`,
      def = BUILDINGS[command.kind];
    world.buildings.push({ id, kind: command.kind as BuildingKind, x, y });
    for (let dy = 0; dy < def.depth; dy++)
      for (let dx = 0; dx < def.width; dx++)
        cellAt(world, x + dx, y + dy)!.occupant = id;
  } else if (cell.occupant) {
    const id = cell.occupant;
    world.buildings = world.buildings.filter((b) => b.id !== id);
    for (const at of world.cells) if (at.occupant === id) at.occupant = null;
  } else {
    cell.road = false;
    // Routes are derived caches; invalidate after topology changes, keeping reserved edges intact.
    for (const vehicle of world.vehicles) {
      vehicle.route = [];
      vehicle.goal = vehicle.to ? { ...vehicle.to } : null;
    }
  }
  world.revision++;
  return result;
}
