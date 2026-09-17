import {
  FREEWAY_SY,
  PARK_SX0,
  PARK_SX1,
  PARK_SY0,
  PARK_SY1,
  RIVER_SX,
  TRAM_SX,
} from "./constants.js";

export interface Slot {
  sx: number;
  sy: number;
}

export function isParkSlot(sx: number, sy: number): boolean {
  return sx >= PARK_SX0 && sx <= PARK_SX1 && sy >= PARK_SY0 && sy <= PARK_SY1;
}

export function isFreewaySlot(_sx: number, sy: number): boolean {
  return sy === FREEWAY_SY;
}

export function isTramSlot(sx: number, sy: number): boolean {
  return sx === TRAM_SX && sy !== FREEWAY_SY;
}

export function isRiverSlot(sx: number, _sy: number): boolean {
  return sx === RIVER_SX;
}

/** Feature corridors reserved from the first lot so addresses never shuffle. */
export function isReservedSlot(sx: number, sy: number): boolean {
  return (
    isParkSlot(sx, sy) ||
    isFreewaySlot(sx, sy) ||
    isTramSlot(sx, sy) ||
    isRiverSlot(sx, sy)
  );
}

/**
 * Slots whose tall odd/parking stamps reach the freeway asphalt.
 * Immediate neighbors are not enough — a 120px civic still overlaps
 * two rows south of FREEWAY_SY.
 */
export function isCorridorShoulderSlot(_sx: number, sy: number): boolean {
  return Math.abs(sy - FREEWAY_SY) <= 2;
}

/**
 * Perimeter of the ring that hugs the park bbox expanded by `ring`.
 * Ring 1 is the Moore neighborhood of the 2×2 park.
 */
export function ringSlots(ring: number): Slot[] {
  if (ring < 1) return [];
  const minX = PARK_SX0 - ring;
  const maxX = PARK_SX1 + ring;
  const minY = PARK_SY0 - ring;
  const maxY = PARK_SY1 + ring;
  const out: Slot[] = [];
  for (let sx = minX; sx <= maxX; sx++) out.push({ sx, sy: minY });
  for (let sy = minY + 1; sy <= maxY; sy++) out.push({ sx: maxX, sy });
  for (let sx = maxX - 1; sx >= minX; sx--) out.push({ sx, sy: maxY });
  for (let sy = maxY - 1; sy > minY; sy--) out.push({ sx: minX, sy });
  return out;
}

/**
 * Sticky lot address: index 0 is always the first unreserved ring cell.
 * Adding a repo only appends; earlier lots never move.
 */
const addressCache: Slot[] = [];
let nextRing = 1;
export function lotSlot(index: number): Slot {
  if (!Number.isInteger(index) || index < 0 || index > 1_000_000)
    throw new Error("Invalid lot index");
  while (addressCache.length <= index) {
    for (const cell of ringSlots(nextRing++))
      if (!isReservedSlot(cell.sx, cell.sy)) addressCache.push(cell);
  }
  return { ...addressCache[index] };
}

export function slotKey(sx: number, sy: number): string {
  return `${sx},${sy}`;
}
