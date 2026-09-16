import type { CityLot } from "../types.js";
import type { LotPlacement } from "../world/layout.js";
import { BUILDING_WIDTH, LOT_D, LOT_W } from "../world/constants.js";
import { spriteBoxFor } from "../render/sprites.js";
import { project } from "../render/iso.js";
import type { Rect } from "./visibility.js";

export function buildingSize(lot: CityLot): { width: number; height: number } {
  const box = spriteBoxFor(lot.buildingId);
  const maxHeight = { S: 128, M: 164, L: 210 }[lot.buildingBand];
  const scale = Math.min(
    BUILDING_WIDTH[lot.buildingBand] / box.w,
    maxHeight / box.h,
  );
  return { width: box.w * scale, height: box.h * scale };
}
export function buildingBounds(place: LotPlacement) {
  const size = buildingSize(place.lot),
    anchor = project(place.x + 1, place.y + LOT_D / 2);
  return { x: anchor.sx - size.width / 2, y: anchor.sy - size.height, ...size };
}

/** Horizontal/bottom padding around the projected lot diamond for `lotPixels`. */
export const LOT_SAMPLE_PAD = 20;
/** Max pixels above the diamond; L tower tops clip so the yard dominates the probe. */
export const LOT_SAMPLE_RISE = 24;

/**
 * Screen-space rectangle used by `lotPixels` / `screenRect`. Click targeting
 * still uses `buildingBounds`. This sample is the isometric lot diamond plus
 * a capped rise for the building foot — not the full 210px L-tower union.
 */
export function lotSampleBounds(place: LotPlacement): Rect {
  const corners = [
    project(place.x, place.y),
    project(place.x + LOT_W, place.y),
    project(place.x, place.y + LOT_D),
    project(place.x + LOT_W, place.y + LOT_D),
  ];
  const left = Math.min(...corners.map((c) => c.sx));
  const right = Math.max(...corners.map((c) => c.sx));
  const diamondTop = Math.min(...corners.map((c) => c.sy));
  const diamondBottom = Math.max(...corners.map((c) => c.sy));
  const diamondH = diamondBottom - diamondTop;
  const rise = Math.min(LOT_SAMPLE_RISE, diamondH * 0.55);
  return {
    x: left - LOT_SAMPLE_PAD,
    y: diamondTop - rise,
    width: right - left + LOT_SAMPLE_PAD * 2,
    height: diamondH + rise + LOT_SAMPLE_PAD,
  };
}
