import type { CityLot, TrendingCadence } from "../types.js";
import {
  cadenceOfSlot,
  nextCadenceSlot,
  TRENDING_DISTRICT,
} from "./trending.js";
import {
  BIKE_BAND,
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
  SHOULDER,
  STRIDE_X,
  STRIDE_Y,
  TRAM_SX,
} from "./constants.js";
import { hash01 } from "./hash.js";
import { isReservedSlot, lotSlot, slotKey } from "./slots.js";

/**
 * Version of the slot-assignment algorithm. Persisted with every lot so a
 * future planner change can migrate explicitly instead of silently moving
 * addresses on a rebuild.
 */
export const LAYOUT_VERSION = 1;

export interface SlotAssignment {
  col: number;
  row: number;
}

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

export type FeatureKind =
  | "park"
  | "freeway"
  | "tram"
  | "plaza"
  | "river"
  | "office"
  | "bike";

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

/** District street label stamped by Phaser and the SVG export. */
export interface MapLabel {
  id: string;
  text: string;
  x: number;
  y: number;
}

/** Non-repo objects the Phaser scene stamps from the shared plan. */
export type CivicKind = "office" | "odd" | "plant" | "parking" | "gate" | "road" | "bike";

export interface CivicMarker {
  kind: CivicKind;
  id: string;
  x: number;
  y: number;
  sprite: string;
}

export interface CityPlan {
  placements: LotPlacement[];
  features: CityFeature[];
  vacancies: VacantPlot[];
  /** Center office, odd unused buildings, plants, parking — never repo lots. */
  civics: CivicMarker[];
  /** Inclusive slot bbox of the developed city (lots + reserved corridors). */
  slotBounds: { minSx: number; maxSx: number; minSy: number; maxSy: number };
  /** World-unit bbox of paved/developed land (not wilderness). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Local street rows that actually have lots beside them. */
  streetRows: number[];
  radius: number;
  /** Daily / weekly / monthly street names when this is Trending City. */
  labels: MapLabel[];
}

export interface PlanOptions {
  now?: Date | string | number;
  /** ISO timestamps keyed by fullName; lots younger than CONSTRUCTION_MS stay sites. */
  addedAt?: Record<string, string>;
  /** Force these repos into the construction animation (tests / live inject). */
  constructing?: Iterable<string>;
  /**
   * Persisted slot assignments keyed by fullName. When present they are used
   * verbatim; lots without one receive the next free ring slot. Slots listed in
   * `reserved` (withdrawn lots' tombstones) are never reassigned.
   */
  assignments?: Record<string, SlotAssignment>;
  reserved?: Iterable<SlotAssignment>;
  /** When true, geographic districts use Daily / Weekly / Monthly names. */
  trending?: boolean;
}

/**
 * First unreserved ring slot that is not in `occupied`. Deterministic, so the
 * same occupied set always yields the same answer.
 */
export function nextFreeSlot(occupied: Set<string>): SlotAssignment {
  for (let i = 0; i < 1_000_000; i++) {
    const slot = lotSlot(i);
    if (!occupied.has(slotKey(slot.sx, slot.sy)))
      return { col: slot.sx, row: slot.sy };
  }
  throw new Error("City is full");
}

/**
 * Assign slots for `names` in order: persisted assignments first, then the
 * next free slot for each newcomer. Used by the store when a lot is added and
 * by the planner when no store exists.
 */
export function assignSlots(
  names: string[],
  assignments: Record<string, SlotAssignment> = {},
  reserved: Iterable<SlotAssignment> = [],
  options: { cadence?: Record<string, TrendingCadence> } = {},
): Record<string, SlotAssignment> {
  const out: Record<string, SlotAssignment> = {};
  const occupied = new Set<string>();
  for (const r of reserved) occupied.add(slotKey(r.col, r.row));
  for (const name of names) {
    const known = assignments[name];
    if (known) {
      out[name] = { ...known };
      occupied.add(slotKey(known.col, known.row));
    }
  }
  for (const name of names) {
    if (out[name]) continue;
    const cadence = options.cadence?.[name];
    const slot = cadence ? nextCadenceSlot(cadence, occupied) : nextFreeSlot(occupied);
    out[name] = slot;
    occupied.add(slotKey(slot.col, slot.row));
  }
  return out;
}

export function slotOrigin(sx: number, sy: number): { x: number; y: number } {
  return { x: sx * STRIDE_X, y: sy * STRIDE_Y };
}

export function districtName(
  sx: number,
  sy: number,
  options: { trending?: boolean } = {},
): string {
  if (
    sx >= PARK_SX0 &&
    sx <= PARK_SX1 &&
    sy >= PARK_SY0 &&
    sy <= PARK_SY1
  ) {
    return "Central Park";
  }
  if (sy === FREEWAY_SY) return "Freeway";
  if (options.trending) {
    const cadence = cadenceOfSlot(sx, sy);
    if (cadence) return TRENDING_DISTRICT[cadence];
  }
  if (
    sx >= PARK_SX0 - 1 &&
    sx <= PARK_SX1 + 1 &&
    sy >= PARK_SY0 - 1 &&
    sy <= PARK_SY1 + 1
  ) {
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
  const reserved = [...(options.reserved ?? [])];
  const cadence: Record<string, TrendingCadence> = {};
  for (const lot of lots) if (lot.cadence) cadence[lot.fullName] = lot.cadence;
  const trending = options.trending === true || Object.keys(cadence).length > 0;
  const slots = assignSlots(
    lots.map((lot) => lot.fullName),
    options.assignments,
    reserved,
    { cadence },
  );
  const placements: LotPlacement[] = lots.map((lot) => {
    const slot = slots[lot.fullName];
    const origin = slotOrigin(slot.col, slot.row);
    return {
      lot,
      col: slot.col,
      row: slot.row,
      x: origin.x,
      y: origin.y,
      constructing: isConstructing(lot.fullName, options, forced),
      district: districtName(slot.col, slot.row, { trending }),
      addedAt: options.addedAt?.[lot.fullName],
    };
  });

  let minSx = PARK_SX0;
  let maxSx = PARK_SX1;
  let minSy = PARK_SY0;
  let maxSy = PARK_SY1;
  for (const place of [...placements, ...reserved]) {
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
  const civics: CivicMarker[] = [];
  for (let sy = minSy; sy <= maxSy; sy++) {
    for (let sx = minSx; sx <= maxSx; sx++) {
      if (isReservedSlot(sx, sy)) continue;
      if (occupied.has(slotKey(sx, sy))) continue;
      const origin = slotOrigin(sx, sy);
      const roll = hash01(sx, sy, 19);
      const variant: VacantPlot["variant"] =
        roll < 0.12
          ? "plaza"
          : roll < 0.28
            ? "trees"
            : roll < 0.4
              ? "dirt"
              : "grass";
      vacancies.push({ sx, sy, x: origin.x, y: origin.y, variant });
      // Occasional odd unused buildings — never assigned to a repository.
      if (variant === "plaza" && hash01(sx, sy, 41) < 0.55) {
        const odd = ["odd-2", "odd-3", "odd-4", "odd-6", "bank-office", "city-hall"];
        civics.push({
          kind: "odd",
          id: `odd-${sx}-${sy}`,
          x: origin.x + 1.1,
          y: origin.y + 1.0,
          sprite: odd[Math.floor(hash01(sx, sy, 7) * odd.length)],
        });
      } else if (variant === "trees" || hash01(sx, sy, 23) < 0.22) {
        civics.push({
          kind: "plant",
          id: `plant-${sx}-${sy}`,
          x: origin.x + 0.8 + hash01(sx, sy, 11) * 1.4,
          y: origin.y + 0.6 + hash01(sx, sy, 13) * 1.0,
          sprite: `plant-${Math.floor(hash01(sx, sy, 17) * 4)}`,
        });
      } else if (variant === "dirt" && hash01(sx, sy, 29) < 0.3) {
        civics.push({
          kind: "parking",
          id: `parking-${sx}-${sy}`,
          x: origin.x + 1.0,
          y: origin.y + 1.1,
          sprite: "parking",
        });
      }
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
    {
      kind: "office",
      id: "city-office",
      x: parkOrigin.x + parkW * 0.28,
      y: parkOrigin.y + parkH * 0.22,
      w: parkW * 0.44,
      h: parkH * 0.5,
    },
    {
      kind: "bike",
      id: "street-bike-lanes",
      x: minSx * STRIDE_X,
      y: minSy * STRIDE_Y + LOT_D + SHOULDER,
      w: (maxSx - minSx + 1) * STRIDE_X,
      h: BIKE_BAND,
    },
  ];

  const parkCx = parkOrigin.x + parkW / 2;
  const parkCy = parkOrigin.y + parkH / 2;
  civics.push({
    kind: "office",
    id: "city-office",
    x: parkCx,
    y: parkCy + 0.15,
    sprite: "office",
  });
  // Dense lot sets can miss the plaza-roll; keep unused odd buildings on vacant plots.
  if (!civics.some((c) => c.kind === "odd")) {
    const oddSprites = ["odd-2", "odd-3", "odd-4", "odd-6", "bank-office", "city-hall"];
    for (const v of vacancies.slice(0, 3)) {
      civics.push({
        kind: "odd",
        id: `odd-spare-${v.sx}-${v.sy}`,
        x: v.x + 1.1,
        y: v.y + 1.0,
        sprite: oddSprites[Math.floor(hash01(v.sx, v.sy, 7) * oddSprites.length)],
      });
    }
  }
  for (const [dx, dy, sprite] of [
    [-3.4, -2.4, "plant-0"],
    [3.2, -2.3, "plant-1"],
    [-3.3, 2.2, "plant-2"],
    [3.1, 2.3, "plant-3"],
    [-1.8, -3.0, "plant-5"],
    [1.6, 2.8, "plant-0"],
  ] as const) {
    civics.push({
      kind: "plant",
      id: `park-plant-${dx}-${dy}`,
      x: parkCx + dx,
      y: parkCy + dy,
      sprite,
    });
  }
  civics.push({
    kind: "gate",
    id: "park-gate-south",
    x: parkCx,
    y: parkOrigin.y + parkH - 0.2,
    sprite: "gate-0",
  });

  const streetRows = [...new Set(placements.map((p) => p.row))].sort(
    (a, b) => a - b,
  );
  // Continuous corridors are painted in terrain. Stamp a few restyled
  // diamonds per row (not every slot) so a 1,000-lot city does not keep
  // thousands of unculled civic images alive.
  for (const row of streetRows) {
    const slots: number[] = [];
    for (let sx = minSx; sx <= maxSx; sx++) {
      if (!isReservedSlot(sx, row)) slots.push(sx);
    }
    const picks = new Set<number>();
    if (slots[0] !== undefined) picks.add(slots[0]);
    if (slots.length > 1) picks.add(slots[slots.length - 1]!);
    if (slots.length > 4) picks.add(slots[Math.floor(slots.length / 2)]!);
    for (const sx of picks) {
      const origin = slotOrigin(sx, row);
      civics.push({
        kind: "road",
        id: `road-${sx}-${row}`,
        x: origin.x + LOT_W * 0.55,
        y: origin.y + LOT_D + SHOULDER + BIKE_BAND + 0.18,
        sprite: ((sx + row) & 1) === 0 ? "road-0" : "road-1",
      });
      civics.push({
        kind: "bike",
        id: `bike-${sx}-${row}`,
        x: origin.x + LOT_W * 0.55,
        y: origin.y + LOT_D + SHOULDER + 0.22,
        sprite: ((sx + row) & 1) === 0 ? "bike-0" : "bike-1",
      });
    }
  }

  const radius = Math.max(
    Math.abs(minSx),
    Math.abs(maxSx),
    Math.abs(minSy),
    Math.abs(maxSy),
  );

  const labels: MapLabel[] = trending
    ? [
        {
          id: "daily-projects",
          text: "DAILY PROJECTS",
          x: slotOrigin(0, -1).x + 2,
          y: slotOrigin(0, -1).y + 1.1,
        },
        {
          id: "weekly-projects",
          text: "WEEKLY PROJECTS",
          x: slotOrigin(4, 0).x + 2,
          y: slotOrigin(4, 0).y + 1.1,
        },
        {
          id: "monthly-projects",
          text: "MONTHLY PROJECTS",
          x: slotOrigin(0, 3).x + 2,
          y: slotOrigin(0, 3).y + 1.1,
        },
      ]
    : [];

  return {
    placements,
    features,
    vacancies,
    civics,
    slotBounds: { minSx, maxSx, minSy, maxSy },
    bounds: {
      minX: minSx * STRIDE_X - 1,
      minY: minSy * STRIDE_Y - 1,
      maxX: (maxSx + 1) * STRIDE_X + 1,
      maxY: (maxSy + 1) * STRIDE_Y + LOT_D + 1,
    },
    streetRows,
    radius,
    labels,
  };
}

export function featureByKind(
  plan: CityPlan,
  kind: FeatureKind,
): CityFeature | undefined {
  return plan.features.find((f) => f.kind === kind);
}
