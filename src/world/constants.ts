/** Shared city-grid constants. World units are isometric tile squares. */

export const LOT_W = 4;
export const LOT_D = 2.4;
export const ROAD_D = 1.0;
export const SHOULDER = 0.35;
export const STRIDE_X = 5.0;
export const STRIDE_Y = LOT_D + ROAD_D + SHOULDER * 2;
export const ROAD_TOP0 = -SHOULDER - ROAD_D;

/** 2×2 slot hole reserved for Central Park (never a repo lot). */
export const PARK_SX0 = 0;
export const PARK_SX1 = 1;
export const PARK_SY0 = 0;
export const PARK_SY1 = 1;

/** East–west freeway corridor (slot row). Lots never occupy this row. */
export const FREEWAY_SY = -2;

/** North–south tram boulevard (slot column). Lots never occupy this column. */
export const TRAM_SX = 2;

/** River west of downtown; extends with the developed radius. */
export const RIVER_SX = -3;

/** How long a newly plotted lot stays a construction site. */
export const CONSTRUCTION_MS = 45_000;

/** Star bands already encode three building sizes; these are the on-pad widths. */
export const BUILDING_WIDTH = {
  S: 112,
  M: 138,
  L: 168,
} as const;
