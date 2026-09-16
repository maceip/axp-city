import type { CityLot } from "../types.js";
import {
  CONSTRUCTION_MS,
  FREEWAY_SY,
  LOT_D,
  LOT_W,
  PARK_SX0,
  PARK_SX1,
  PARK_SY0,
  PARK_SY1,
  RIVER_SX,
  ROAD_D,
  STRIDE_X,
  STRIDE_Y,
  TRAM_SX,
} from "./constants.js";
import { hash01 } from "./hash.js";
import { isReservedSlot, lotSlot, slotKey } from "./slots.js";

export interface LotPlacement {
  lot: CityLot;
  col: number;
  row: number;
  x: number;
  y: number;
  constructing: boolean;
  district: string;
  addedAt?: string;
}

export type FeatureKind = "park" | "freeway" | "tram" | "plaza" | "river";

export interface CityFeature {
  kind: FeatureKind;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VacantPlot {
  sx: number;
  sy: number;
  x: number;
  y: number;
  variant: "grass" | "dirt" | "trees" | "plaza";
}

export interface CityPlan {
  placements: LotPlacement[];
  features: CityFeature[];
  vacancies: VacantPlot[];
  /** Inclusive slot bbox of the developed city (lots + reserved corridors). */
  slotBounds: { minSx: number; maxSx: number; minSy: number; maxSy: number };
  /** World-unit bbox of paved/developed land (not wilderness). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Local street rows that actually have lots beside them. */
  streetRows: number[];
  radius: number;
}

export interface PlanOptions {
  now?: Date | string | number;
  /** ISO timestamps keyed by fullName; lots younger than CONSTRUCTION_MS stay sites. */
  addedAt?: Record<string, string>;
  /** Force these repos into the construction animation (tests / live inject). */
  constructing?: Iterable<string>;
}

export function slotOrigin(sx: number, sy: number): { x: number; y: number } {
  return { x: sx * STRIDE_X, y: sy * STRIDE_Y };
}

export function districtName(sx: number, sy: number): string {
  if (sx >= PARK_SX0 - 1 && sx <= PARK_SX1 + 1 && sy >= PARK_SY0 - 1 && sy <= PARK_SY1 + 1) {
    return "Central Park";
  }
  if (sy === FREEWAY_SY || sy === FREEWAY_SY - 1 || sy === FREEWAY_SY + 1) {
    return "Freeway";
  }
  if (sx === TRAM_SX || sx === TRAM_SX - 1 || sx === TRAM_SX + 1) {
    return "Tram Line";
  }
  if (sx <= RIVER_SX + 1) return "Riverside";
  if (sy < PARK_SY0) return "North Ward";
  if (sy > PARK_SY1) return "South Ward";
  if (sx < PARK_SX0) return "West Ward";
  return "East Ward";
}

function isConstructing(
  fullName: string,
  options: PlanOptions,
  forced: Set<string>,
): boolean {
  if (forced.has(fullName)) return true;
  const added = options.addedAt?.[fullName];
  if (!added) return false;
  const now = new Date(options.now ?? Date.now()).getTime();
  const at = Date.parse(added);
  if (Number.isNaN(at)) return false;
  return now - at < CONSTRUCTION_MS;
}

/**
 * Pave features from the current lot set. Corridors were reserved from lot 0,
 * so growing the freeway/tram only fills empty reserved land — never moves a repo.
 */
export function planCity(lots: CityLot[], options: PlanOptions = {}): CityPlan {
  const forced = new Set(options.constructing ?? []);
  const placements: LotPlacement[] = lots.map((lot, i) => {
    const slot = lotSlot(i);
    const origin = slotOrigin(slot.sx, slot.sy);
    return {
      lot,
      col: slot.sx,
      row: slot.sy,
      x: origin.x,
      y: origin.y,
      constructing: isConstructing(lot.fullName, options, forced),
      district: districtName(slot.sx, slot.sy),
      addedAt: options.addedAt?.[lot.fullName],
    };
  });

  let minSx = PARK_SX0;
  let maxSx = PARK_SX1;
  let minSy = PARK_SY0;
  let maxSy = PARK_SY1;
  for (const place of placements) {
    minSx = Math.min(minSx, place.col);
    maxSx = Math.max(maxSx, place.col);
    minSy = Math.min(minSy, place.row);
    maxSy = Math.max(maxSy, place.row);
  }
  // One extra ring so new lots have a graded plot waiting, and features reach them.
  minSx -= 1;
  maxSx += 1;
  minSy -= 1;
  maxSy += 1;
  minSx = Math.min(minSx, RIVER_SX);
  minSy = Math.min(minSy, FREEWAY_SY);

  const occupied = new Set(placements.map((p) => slotKey(p.col, p.row)));
  const vacancies: VacantPlot[] = [];
  for (let sy = minSy; sy <= maxSy; sy++) {
    for (let sx = minSx; sx <= maxSx; sx++) {
      if (isReservedSlot(sx, sy)) continue;
      if (occupied.has(slotKey(sx, sy))) continue;
      const origin = slotOrigin(sx, sy);
      const roll = hash01(sx, sy, 19);
      const variant: VacantPlot["variant"] =
        roll < 0.12 ? "plaza" : roll < 0.28 ? "trees" : roll < 0.4 ? "dirt" : "grass";
      vacancies.push({ sx, sy, x: origin.x, y: origin.y, variant });
    }
  }

  const parkOrigin = slotOrigin(PARK_SX0, PARK_SY0);
  const parkW = (PARK_SX1 - PARK_SX0 + 1) * STRIDE_X - 0.2;
  const parkH = (PARK_SY1 - PARK_SY0 + 1) * STRIDE_Y - ROAD_D * 0.2;
  const freewayOrigin = slotOrigin(minSx, FREEWAY_SY);
  const tramOrigin = slotOrigin(TRAM_SX, minSy);
  const riverOrigin = slotOrigin(RIVER_SX, minSy);

  const features: CityFeature[] = [
    {
      kind: "park",
      id: "central-park",
      x: parkOrigin.x + 0.1,
      y: parkOrigin.y + 0.1,
      w: parkW,
      h: parkH,
    },
    {
      kind: "freeway",
      id: "north-freeway",
      x: freewayOrigin.x,
      y: freewayOrigin.y,
      w: (maxSx - minSx + 1) * STRIDE_X,
      h: STRIDE_Y,
    },
    {
      kind: "tram",
      id: "tram-line",
      x: tramOrigin.x,
      y: tramOrigin.y,
      w: STRIDE_X,
      h: (maxSy - minSy + 1) * STRIDE_Y,
    },
    {
      kind: "river",
      id: "west-river",
      x: riverOrigin.x + 0.4,
      y: riverOrigin.y,
      w: LOT_W * 0.55,
      h: (maxSy - minSy + 1) * STRIDE_Y,
    },
    {
      kind: "plaza",
      id: "tram-park-plaza",
      x: slotOrigin(TRAM_SX, PARK_SY0).x + 0.2,
      y: slotOrigin(TRAM_SX, PARK_SY0).y + 0.2,
      w: STRIDE_X - 0.4,
      h: STRIDE_Y * 2 - 0.4,
    },
  ];

  const streetRows = [...new Set(placements.map((p) => p.row))].sort((a, b) => a - b);

  const radius = Math.max(
    Math.abs(minSx),
    Math.abs(maxSx),
    Math.abs(minSy),
    Math.abs(maxSy),
  );

  return {
    placements,
    features,
    vacancies,
    slotBounds: { minSx, maxSx, minSy, maxSy },
    bounds: {
      minX: minSx * STRIDE_X - 1,
      minY: minSy * STRIDE_Y - 1,
      maxX: (maxSx + 1) * STRIDE_X + 1,
      maxY: (maxSy + 1) * STRIDE_Y + LOT_D + 1,
    },
    streetRows,
    radius,
  };
}

export function featureByKind(plan: CityPlan, kind: FeatureKind): CityFeature | undefined {
  return plan.features.find((f) => f.kind === kind);
}
