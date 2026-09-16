import type { CityPlan } from "./layout.js";
import { LOT_D, LOT_W, SHOULDER, STRIDE_X, STRIDE_Y } from "./constants.js";
import { hash01 } from "./hash.js";
import { isFreewaySlot, isParkSlot, isRiverSlot, isTramSlot } from "./slots.js";

export type GroundKind =
  | "park"
  | "freeway"
  | "tram"
  | "river"
  | "lot"
  | "vacant"
  | "street"
  | "bike"
  | "grass"
  | "dirt"
  | "water"
  | "trees";

/**
 * Ground cover for any integer world cell. Developed features are a function
 * of the current lot set (plan); everything else is a stable hash so panning
 * never invents parks or freeways — those only grow when a repo is plotted.
 */
const occupiedCache = new WeakMap<CityPlan, Set<string>>();

export function tileKind(ix: number, iy: number, plan: CityPlan): GroundKind {
  const sx = Math.floor(ix / STRIDE_X);
  const sy = Math.floor(iy / STRIDE_Y);
  const { minSx, maxSx, minSy, maxSy } = plan.slotBounds;

  const inDeveloped = sx >= minSx && sx <= maxSx && sy >= minSy && sy <= maxSy;
  if (inDeveloped) {
    if (isParkSlot(sx, sy)) return "park";
    if (isFreewaySlot(sx, sy)) return "freeway";
    if (isTramSlot(sx, sy)) return "tram";
    if (isRiverSlot(sx, sy)) return "river";
    const localX = ix - sx * STRIDE_X;
    const localY = iy - sy * STRIDE_Y;
    if (localY >= LOT_D + SHOULDER || localX >= LOT_W + SHOULDER) {
      if (localY >= LOT_D + SHOULDER && localY < LOT_D + SHOULDER + 0.32)
        return "bike";
      return "street";
    }
    let occupied = occupiedCache.get(plan);
    if (!occupied) {
      occupied = new Set(plan.placements.map((p) => `${p.col},${p.row}`));
      occupiedCache.set(plan, occupied);
    }
    if (occupied.has(`${sx},${sy}`)) return "lot";
    return "vacant";
  }

  const roll = hash01(ix, iy, 91);
  if (roll < 0.04) return "water";
  if (roll < 0.1) return "dirt";
  if (roll < 0.22) return "trees";
  return "grass";
}
