import { DIRECTIONS, type Cell, type Point, type WorldState } from "./types.js";
export function key(x: number, y: number): string {
  return `${x},${y}`;
}
export function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
export function cellAt(
  world: WorldState,
  x: number,
  y: number,
): Cell | undefined {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < world.minX ||
    y < world.minY ||
    x >= world.minX + world.width ||
    y >= world.minY + world.height
  )
    return undefined;
  return world.cells[(y - world.minY) * world.width + x - world.minX];
}
export function roadMask(world: WorldState, x: number, y: number): number {
  if (!cellAt(world, x, y)?.road) return 0;
  return DIRECTIONS.reduce(
    (mask, d) => mask | (cellAt(world, x + d.x, y + d.y)?.road ? d.bit : 0),
    0,
  );
}
/** Connected water neighbors; out-of-map cells are open water for shore edges. */
export function waterMask(world: WorldState, x: number, y: number): number {
  if (cellAt(world, x, y)?.terrain !== "water") return 0;
  return DIRECTIONS.reduce((mask, d) => {
    const cell = cellAt(world, x + d.x, y + d.y);
    return mask | (!cell || cell.terrain === "water" ? d.bit : 0);
  }, 0);
}
export function roadCells(world: WorldState): Point[] {
  const out: Point[] = [];
  world.cells.forEach((cell, i) => {
    if (cell.road)
      out.push({
        x: world.minX + (i % world.width),
        y: world.minY + Math.floor(i / world.width),
      });
  });
  return out;
}
/** BFS with stable N/E/S/W tie breaking; each returned point is an adjacent road tile. */
export function findRoute(
  world: WorldState,
  from: Point,
  to: Point,
  blocked = new Set<string>(),
): Point[] | null {
  if (!cellAt(world, from.x, from.y)?.road || !cellAt(world, to.x, to.y)?.road)
    return null;
  const start = key(from.x, from.y),
    end = key(to.x, to.y);
  if (start === end) return [];
  if (blocked.has(end)) return null;
  const queue: Point[] = [{ ...from }];
  const previous = new Map<string, Point | null>([[start, null]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const at = queue[cursor];
    for (const d of DIRECTIONS) {
      const next = { x: at.x + d.x, y: at.y + d.y },
        id = key(next.x, next.y);
      if (
        previous.has(id) ||
        blocked.has(id) ||
        !cellAt(world, next.x, next.y)?.road
      )
        continue;
      previous.set(id, at);
      if (id === end) {
        const path: Point[] = [next];
        let parent = at;
        while (!same(parent, from)) {
          path.push(parent);
          parent = previous.get(key(parent.x, parent.y))!;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}
export function connectedRoads(world: WorldState, excluded?: Point): boolean {
  const roads = roadCells(world).filter((p) => !excluded || !same(p, excluded));
  if (!roads.length) return true;
  const seen = new Set([key(roads[0].x, roads[0].y)]),
    queue = [roads[0]];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const p = queue[cursor];
    for (const d of DIRECTIONS) {
      const next = { x: p.x + d.x, y: p.y + d.y },
        id = key(next.x, next.y);
      if (
        seen.has(id) ||
        (excluded && same(next, excluded)) ||
        !cellAt(world, next.x, next.y)?.road
      )
        continue;
      seen.add(id);
      queue.push(next);
    }
  }
  return seen.size === roads.length;
}
