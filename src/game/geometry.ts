import type { CityLot } from "../types.js";
import type { LotPlacement } from "../world/layout.js";
import { BUILDING_WIDTH, LOT_D } from "../world/constants.js";
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

/** Padding around the building crown used by `lotPixels`. */
export const LOT_SAMPLE_PAD = 12;

/**
 * Screen-space rectangle used by `lotPixels` / `screenRect`. Click targeting
 * still uses `buildingBounds`. Neighbouring civic stamps (the 480px park
 * office) cover lot diamonds that sit behind them, so this sample is the
 * upper ~70% of the building sprite — the part that clears those overlays.
 */
export function lotSampleBounds(place: LotPlacement): Rect {
  const tower = buildingBounds(place);
  const height = Math.max(72, tower.height * 0.7);
  return {
    x: tower.x - LOT_SAMPLE_PAD,
    y: tower.y - 4,
    width: tower.width + LOT_SAMPLE_PAD * 2,
    height,
  };
}
