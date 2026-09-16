import type { CityLot } from "../types.js";
import type { LotPlacement } from "../world/layout.js";
import { BUILDING_WIDTH, LOT_D } from "../world/constants.js";
import { spriteBoxFor } from "../render/sprites.js";
import { project } from "../render/iso.js";
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
