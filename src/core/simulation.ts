import {
  DIRECTIONS,
  EDGE_TICKS,
  TICK_MS,
  type Heading,
  type Point,
  type Vehicle,
  type WorldState,
} from "./types.js";
import { findRoute, key, roadCells, same } from "./grid.js";
/** A small integer hash makes destination selection reproducible without global RNG state. */
export function mix(seed: number, value: number): number {
  let n = Math.imul(seed ^ value, 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
function heading(from: Point, to: Point): Heading {
  return DIRECTIONS.find((d) => from.x + d.x === to.x && from.y + d.y === to.y)!
    .heading;
}
function occupiedByOthers(world: WorldState, vehicle: Vehicle): Set<string> {
  const occupied = new Set<string>();
  for (const other of world.vehicles) {
    if (other === vehicle) continue;
    occupied.add(key(other.x, other.y));
    if (other.to) occupied.add(key(other.to.x, other.to.y));
  }
  return occupied;
}
function chooseRoute(
  world: WorldState,
  vehicle: Vehicle,
  blocked: Set<string>,
): Point[] {
  if (vehicle.goal && !same(vehicle, vehicle.goal)) {
    const route = findRoute(world, vehicle, vehicle.goal, blocked);
    if (route?.length) return route;
  }
  const roads = roadCells(world);
  const id = Number(vehicle.id.split("-").at(-1)) || 1;
  const offset =
    mix(world.seed, id * 4099 + vehicle.trips * 131) % roads.length;
  // Different destinations avoid permanent head-on waits on dead-end branches.
  for (let i = 0; i < roads.length; i++) {
    const goal = roads[(offset + i) % roads.length];
    if (same(vehicle, goal) || blocked.has(key(goal.x, goal.y))) continue;
    const route = findRoute(world, vehicle, goal, blocked);
    if (route?.length) {
      vehicle.goal = { ...goal };
      return route;
    }
  }
  vehicle.goal = null;
  return [];
}
function step(world: WorldState): void {
  world.tick++;
  const vehicles = [...world.vehicles].sort((a, b) => a.id.localeCompare(b.id));
  // Complete movements before taking reservations. Both endpoints stay reserved while in transit.
  for (const vehicle of vehicles) {
    if (!vehicle.to) continue;
    vehicle.progress =
      (Math.round(vehicle.progress * EDGE_TICKS) + 1) / EDGE_TICKS;
    if (vehicle.progress < 1) continue;
    vehicle.x = vehicle.to.x;
    vehicle.y = vehicle.to.y;
    vehicle.to = null;
    vehicle.progress = 0;
    if (vehicle.goal && same(vehicle, vehicle.goal)) {
      vehicle.goal = null;
      vehicle.route = [];
      vehicle.trips++;
    }
  }
  for (const vehicle of vehicles) {
    if (vehicle.to) continue;
    const blocked = occupiedByOthers(world, vehicle);
    if (
      !vehicle.route.length ||
      blocked.has(key(vehicle.route[0].x, vehicle.route[0].y))
    )
      vehicle.route = chooseRoute(world, vehicle, blocked);
    const next = vehicle.route[0];
    if (!next || blocked.has(key(next.x, next.y))) continue;
    vehicle.route.shift();
    vehicle.heading = heading(vehicle, next);
    vehicle.to = { ...next };
    vehicle.progress = 0;
  }
}
/** Fixed 100ms simulation ticks. Frame time affects only the retained sub-tick remainder. */
export function advanceWorld(world: WorldState, elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new Error("Elapsed time must be a finite non-negative number.");
  const elapsed = world.accumulatorMs + elapsedMs;
  if (
    !Number.isSafeInteger(Math.floor(elapsed)) ||
    !Number.isSafeInteger(world.tick + Math.floor(elapsed / TICK_MS))
  )
    throw new Error("Elapsed time exceeds the simulation clock range.");
  const ticks = Math.floor((elapsed + 1e-8) / TICK_MS);
  const remainder = elapsed - ticks * TICK_MS;
  // Only normalize floating-point noise at tick boundaries. Rounding every
  // frame would accumulate drift at common fractional frame times (1000/60).
  world.accumulatorMs = Math.abs(remainder) < 1e-8 ? 0 : remainder;
  for (let i = 0; i < ticks; i++) step(world);
}
export function vehiclePose(
  world: WorldState,
  vehicle: Vehicle,
): { x: number; y: number; heading: Heading } {
  // Interpolate within the next fixed step using the reserved edge only. This
  // never changes authoritative progress or lets rendering enter an unreserved tile.
  const progress = Math.min(
    1 - 1e-9,
    vehicle.progress + world.accumulatorMs / TICK_MS / EDGE_TICKS,
  );
  return {
    x:
      vehicle.x +
      0.5 +
      (vehicle.to ? (vehicle.to.x - vehicle.x) * progress : 0),
    y:
      vehicle.y +
      0.5 +
      (vehicle.to ? (vehicle.to.y - vehicle.y) * progress : 0),
    heading: vehicle.heading,
  };
}
