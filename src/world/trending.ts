import {
  FREEWAY_SY,
  LOT_D,
  PARK_SX0,
  PARK_SY0,
  PARK_SY1,
  RIVER_SX,
  STRIDE_X,
  STRIDE_Y,
  TRAM_SX,
} from "./constants.js";
import { isReservedSlot, slotKey, type Slot } from "./slots.js";
import type { TrendingCadence } from "../types.js";

export type { TrendingCadence };

export const TRENDING_DISTRICT: Record<TrendingCadence, string> = {
  daily: "Daily Projects",
  weekly: "Weekly Projects",
  monthly: "Monthly Projects",
};

/**
 * Street-name plaques along the reserved tram boulevard — never on a lot pad
 * or Kenney loading apron. Daily sits north of the park, weekly beside it,
 * monthly south, so the labels survive park-clamp trees and lot 24 neighbours.
 */
export function trendingDistrictLabels(): Array<{
  id: string;
  text: string;
  x: number;
  y: number;
}> {
  const onTram = (row: number) => ({
    x: TRAM_SX * STRIDE_X + STRIDE_X / 2,
    y: row * STRIDE_Y + LOT_D / 2,
  });
  return [
    { id: "daily-projects", text: "DAILY PROJECTS", ...onTram(PARK_SY0 - 1) },
    { id: "weekly-projects", text: "WEEKLY PROJECTS", ...onTram(PARK_SY1) },
    { id: "monthly-projects", text: "MONTHLY PROJECTS", ...onTram(PARK_SY1 + 1) },
  ];
}

/** North of the park, skipping the freeway corridor. */
export function isDailyDistrict(sx: number, sy: number): boolean {
  return sy < PARK_SY0 && sy !== FREEWAY_SY;
}

/** East of the tram boulevard. */
export function isWeeklyDistrict(sx: number, sy: number): boolean {
  return sx > TRAM_SX && sy >= PARK_SY0;
}

/** South of the park, west of the tram so it does not overlap Weekly. */
export function isMonthlyDistrict(sx: number, sy: number): boolean {
  return sy > PARK_SY1 && sx <= TRAM_SX;
}

const DAILY_ROWS = [-1, -3, -4, -5, -6, -7, -8, -9];
const DAILY_COLS = [-2, -1, 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const WEEKLY_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const WEEKLY_COLS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MONTHLY_ROWS = [2, 3, 4, 5, 6, 7, 8, 9];
const MONTHLY_COLS = [-2, -1, 0, 1, -4, -5, -6, -7];

function cells(rows: number[], cols: number[]): Slot[] {
  const out: Slot[] = [];
  for (const sy of rows) {
    for (const sx of cols) {
      if (sx === RIVER_SX || isReservedSlot(sx, sy)) continue;
      out.push({ sx, sy });
    }
  }
  return out;
}

/** Deterministic slot pool for one trending cadence. */
export function cadenceSlots(cadence: TrendingCadence): Slot[] {
  if (cadence === "daily") return cells(DAILY_ROWS, DAILY_COLS);
  if (cadence === "weekly") return cells(WEEKLY_ROWS, WEEKLY_COLS);
  return cells(MONTHLY_ROWS, MONTHLY_COLS);
}

/**
 * Next free slot in a cadence district. Persisted assignments are applied
 * before this runs, so a repo that stays on the list never moves.
 */
export function nextCadenceSlot(
  cadence: TrendingCadence,
  occupied: Set<string>,
): { col: number; row: number } {
  for (const slot of cadenceSlots(cadence)) {
    if (!occupied.has(slotKey(slot.sx, slot.sy)))
      return { col: slot.sx, row: slot.sy };
  }
  throw new Error(`Trending ${cadence} district is full`);
}

export function cadenceOfSlot(sx: number, sy: number): TrendingCadence | undefined {
  if (isDailyDistrict(sx, sy)) return "daily";
  if (isWeeklyDistrict(sx, sy)) return "weekly";
  if (isMonthlyDistrict(sx, sy)) return "monthly";
  return undefined;
}
