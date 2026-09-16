/** Screen-space lot picking for the isometric map (shared with the inlined client). */

export const PICK_LOT_W = 4;
export const PICK_LOT_D = 2.4;

export interface PickableLot {
  repo: string;
  x: number;
  y: number;
  band?: string;
}

export function worldToScreen(
  x: number,
  y: number,
  tileW = 72,
  tileH = 36,
): { sx: number; sy: number } {
  return { sx: (x - y) * (tileW / 2), sy: (x + y) * (tileH / 2) };
}

export function screenToWorld(
  sx: number,
  sy: number,
  tileW = 72,
  tileH = 36,
): { x: number; y: number } {
  return { x: sx / tileW + sy / tileH, y: sy / tileH - sx / tileW };
}

export function buildingHitSize(band?: string): { w: number; h: number } {
  if (band === "L") return { w: 180, h: 240 };
  if (band === "M") return { w: 150, h: 190 };
  return { w: 124, h: 150 };
}

/** True when (wx, wy) sits on the lot pad diamond in world tiles. */
export function onLotPad(lot: PickableLot, wx: number, wy: number): boolean {
  return (
    wx >= lot.x &&
    wx <= lot.x + PICK_LOT_W &&
    wy >= lot.y &&
    wy <= lot.y + PICK_LOT_D
  );
}

/**
 * Pick the lot under an SVG-user-space click. Prefers the pad diamond, then
 * the building slab that rises from that pad. Returns null for wilderness.
 */
export function pickLot(
  lots: PickableLot[],
  sx: number,
  sy: number,
  tileW = 72,
  tileH = 36,
): PickableLot | null {
  const world = screenToWorld(sx, sy, tileW, tileH);
  let best: PickableLot | null = null;
  let bestScore = Infinity;
  for (const lot of lots) {
    if (onLotPad(lot, world.x, world.y)) return lot;
    const c = worldToScreen(lot.x + PICK_LOT_W / 2, lot.y + PICK_LOT_D / 2, tileW, tileH);
    const hit = buildingHitSize(lot.band);
    const dx = (sx - c.sx) / (hit.w / 2);
    const dy = (sy - (c.sy - hit.h * 0.38)) / (hit.h / 2);
    const score = dx * dx + dy * dy;
    if (score < 1 && score < bestScore) {
      bestScore = score;
      best = lot;
    }
  }
  return best;
}
