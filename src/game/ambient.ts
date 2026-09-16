import { hash01 } from "../world/hash.js";
import type { CityPlan } from "../world/layout.js";

/**
 * Ambient life that belongs to the city's civic features rather than to a lot:
 * freeway traffic, the tram, and park pedestrians. The definitions are pure
 * data derived from the shared plan so the Phaser scene and exports agree on
 * where actors travel; the scene owns the clock. Ambient positions are
 * simulated per browser and are not synchronised between visitors.
 */
export type AmbientKind = "car" | "tram" | "pedestrian";

export interface WorldPoint {
  x: number;
  y: number;
}

export interface AmbientActor {
  id: string;
  kind: AmbientKind;
  /** Texture / animation key the client uses. */
  anim: string;
  /** World-unit polyline. */
  path: WorldPoint[];
  /** World units per second. */
  speed: number;
  /** wrap: reappear at the start; yoyo: reverse at the ends; stand: stay put. */
  motion: "wrap" | "yoyo" | "stand";
  /** Initial position along the path (0..1). */
  offset: number;
  /** Path parameters (0..1) where the actor pauses, and for how long. */
  stops?: { at: number[]; dwellMs: number };
  tint?: number;
  /** Target width in screen pixels. */
  width: number;
  /** Mirror the sprite when travelling in −x screen direction. */
  faces: boolean;
  /** Screen-pixel lift above the ground anchor (vehicles sit on their wheels). */
  lift?: number;
}

const CAR_COLOURS = [0xc45c26, 0x2a6f97, 0xd9e4ee, 0x3f7d4a, 0xe0b34a, 0x6a4c93];

export function pathLength(path: WorldPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++)
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return total;
}

/** Point along a polyline at parameter t in [0,1], plus its travel direction. */
export function pointAlong(
  path: WorldPoint[],
  t: number,
): WorldPoint & { dx: number; dy: number } {
  if (path.length === 1) return { ...path[0], dx: 0, dy: 0 };
  const total = pathLength(path);
  let distance = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance <= len || i === path.length - 1) {
      const k = len === 0 ? 0 : Math.min(distance / len, 1);
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        dx: len === 0 ? 0 : (b.x - a.x) / len,
        dy: len === 0 ? 0 : (b.y - a.y) / len,
      };
    }
    distance -= len;
  }
  const last = path[path.length - 1];
  return { ...last, dx: 0, dy: 0 };
}

export function ambientActors(plan: CityPlan): AmbientActor[] {
  const actors: AmbientActor[] = [];
  const freeway = plan.features.find((f) => f.kind === "freeway");
  if (freeway) {
    const lanes = [freeway.y + freeway.h * 0.32, freeway.y + freeway.h * 0.62];
    const count = Math.min(28, Math.max(4, Math.round(freeway.w / 5)));
    for (let i = 0; i < count; i++) {
      const eastbound = i % 2 === 0;
      const lane = lanes[eastbound ? 0 : 1];
      const from = { x: freeway.x + 0.3, y: lane };
      const to = { x: freeway.x + freeway.w - 0.3, y: lane };
      actors.push({
        id: `car-${i}`,
        kind: "car",
        anim: "car",
        path: eastbound ? [from, to] : [to, from],
        speed: 3.2 + hash01(i, 1, 77) * 2.2,
        motion: "wrap",
        offset: (i / count + hash01(i, 2, 77) * 0.08) % 1,
        tint: CAR_COLOURS[i % CAR_COLOURS.length],
        width: 44,
        faces: true,
        lift: 4,
      });
    }
  }
  const tram = plan.features.find((f) => f.kind === "tram");
  const plaza = plan.features.find((f) => f.kind === "plaza");
  if (tram) {
    const x = tram.x + tram.w * 0.5;
    const path = [
      { x, y: tram.y + 0.6 },
      { x, y: tram.y + tram.h - 0.6 },
    ];
    const stopAt: number[] = [];
    if (plaza) {
      const total = pathLength(path);
      const stationY = plaza.y + plaza.h / 2;
      stopAt.push(Math.min(1, Math.max(0, (stationY - path[0].y) / total)));
    }
    const trams = tram.h > 60 ? 2 : 1;
    for (let i = 0; i < trams; i++)
      actors.push({
        id: `tram-${i}`,
        kind: "tram",
        anim: "tram",
        path,
        speed: 4.2,
        motion: "yoyo",
        offset: i === 0 ? 0.15 : 0.7,
        stops: { at: stopAt, dwellMs: 3500 },
        width: 92,
        faces: true,
        lift: 6,
      });
  }
  const park = plan.features.find((f) => f.kind === "park");
  if (park) {
    const cx = park.x + park.w / 2,
      cy = park.y + park.h / 2;
    const loops: WorldPoint[][] = [
      [
        { x: cx - 2.6, y: cy - 1.6 },
        { x: cx + 2.6, y: cy - 1.6 },
        { x: cx + 2.6, y: cy + 1.6 },
        { x: cx - 2.6, y: cy + 1.6 },
        { x: cx - 2.6, y: cy - 1.6 },
      ],
      [
        { x: park.x + 0.9, y: park.y + 0.8 },
        { x: park.x + park.w - 0.9, y: park.y + 0.8 },
      ],
      [
        { x: park.x + 0.9, y: park.y + park.h - 0.8 },
        { x: park.x + park.w - 0.9, y: park.y + park.h - 0.8 },
      ],
      [
        { x: park.x + 0.9, y: park.y + 0.9 },
        { x: park.x + 0.9, y: park.y + park.h - 0.9 },
      ],
    ];
    loops.forEach((path, i) =>
      actors.push({
        id: `walker-${i}`,
        kind: "pedestrian",
        anim: "humanWalk",
        path,
        speed: 0.55 + hash01(i, 3, 77) * 0.25,
        motion: i === 0 ? "wrap" : "yoyo",
        offset: hash01(i, 4, 77),
        width: 18,
        faces: true,
      }),
    );
    const standing: Array<[WorldPoint, string]> = [
      [{ x: cx - 1.2, y: cy + 0.9 }, "humanWave"],
      [{ x: cx + 1.4, y: cy - 0.8 }, "humanWave"],
      [{ x: park.x + park.w - 1.6, y: park.y + park.h - 1.4 }, "humanWork"],
    ];
    standing.forEach(([point, anim], i) =>
      actors.push({
        id: `stander-${i}`,
        kind: "pedestrian",
        anim,
        path: [point],
        speed: 0,
        motion: "stand",
        offset: 0,
        width: 18,
        faces: false,
      }),
    );
  }
  return actors;
}
