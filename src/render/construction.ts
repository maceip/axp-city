import type { LotPlacement } from "../world/layout.js";
import { BUILDING_WIDTH } from "../world/constants.js";
import { animatedFigure } from "./anim.js";
import { diamond, fmt, project } from "./iso.js";
import { animSheet, CONE_TILE, GROUND_SHEET, type StampFn } from "./sprites.js";

/**
 * New-plot construction: graded dirt, cones, a crane, and a rising scaffold
 * that hides the unfinished building. Three scaffold heights follow S/M/L.
 */
export function constructionSite(
  place: LotPlacement,
  stamp: StampFn,
  lotTag: string,
): string {
  const { lot, x, y } = place;
  const band = lot.buildingBand;
  const height = band === "L" ? 78 : band === "M" ? 58 : 40;
  const width = BUILDING_WIDTH[band] * 0.55;
  const pad = project(x + 1.1, y + 1.15);
  const crane = project(x + 0.15, y + 1.3);
  const coneA = project(x + 0.35, y + 0.4);
  const coneB = project(x + 3.4, y + 1.8);
  const coneC = project(x + 3.1, y + 0.35);
  const poles = [
    [-width / 2, -height],
    [width / 2 - 3, -height],
    [-width / 2, -height * 0.55],
    [width / 2 - 3, -height * 0.55],
  ];
  let scaffold = "";
  for (const [px, py] of poles) {
    scaffold += `<rect x="${fmt(pad.sx + px)}" y="${fmt(pad.sy + py)}" width="3" height="${fmt(-py)}" fill="#c4a574" stroke="#6b4f2a" stroke-width="0.6"/>`;
  }
  scaffold +=
    `<rect x="${fmt(pad.sx - width / 2)}" y="${fmt(pad.sy - height)}" width="${fmt(width)}" height="4" fill="#d7b07a" stroke="#6b4f2a" stroke-width="0.5"/>` +
    `<rect x="${fmt(pad.sx - width / 2)}" y="${fmt(pad.sy - height * 0.55)}" width="${fmt(width)}" height="3" fill="#d7b07a" stroke="#6b4f2a" stroke-width="0.5"/>`;
  const rise =
    `<rect x="${fmt(pad.sx - width / 2 - 4)}" y="${fmt(pad.sy - 6)}" width="${fmt(width + 8)}" height="8" fill="#b8894c">` +
    `<animate attributeName="y" values="${fmt(pad.sy - 6)};${fmt(pad.sy - height - 4)}" dur="8s" fill="freeze"/>` +
    `<animate attributeName="height" values="8;${fmt(height + 4)}" dur="8s" fill="freeze"/>` +
    `</rect>`;
  const cones =
    stamp(GROUND_SHEET.file, GROUND_SHEET, CONE_TILE, coneA.sx, coneA.sy, 22, false) +
    stamp(GROUND_SHEET.file, GROUND_SHEET, CONE_TILE, coneB.sx, coneB.sy, 22, false) +
    stamp(GROUND_SHEET.file, GROUND_SHEET, CONE_TILE, coneC.sx, coneC.sy, 20, false);
  return (
    `<g class="construction" data-band="${band}">` +
    diamond(x + 0.2, y + 0.2, 3.6, 2.0, "#c9a06b", "rgba(80,50,20,0.25)") +
    cones +
    scaffold +
    rise +
    animatedFigure({
      id: `${lotTag}-site-crane`,
      sheet: animSheet("craneArm"),
      anchorX: crane.sx,
      anchorY: crane.sy,
      targetW: band === "L" ? 62 : band === "M" ? 54 : 48,
      phase: -1.2,
    }) +
    `</g>`
  );
}
