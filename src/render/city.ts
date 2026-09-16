import type { CityLot } from "../types.js";
import {
  BUILDING_WIDTH,
  LOT_D,
  LOT_W,
  STRIDE_Y,
  hash01,
  planCity,
  type CityPlan,
  type LotPlacement,
  type PlanOptions,
} from "../world/index.js";
import { renderAirLayer } from "./air.js";
import { animatedFigure } from "./anim.js";
import { constructionSite } from "./construction.js";
import { localStreet, renderFeatures, renderVacant } from "./features.js";
import { pacingHuman } from "./humans.js";
import { diamond, fmt, project, TILE_H, TILE_W } from "./iso.js";
import { renderYardProps } from "./props.js";
import {
  animSheet,
  GROUND_SHEET,
  LOT_TILE_DIRT,
  LOT_TILE_GRASS,
  sheetForBand,
  spriteBoxFor,
  stamper,
  WILD_BUSHES,
  WILD_SHEETS,
  WILD_TREES,
  type SpriteBox,
  type StampFn,
} from "./sprites.js";

export type { LotPlacement } from "../world/index.js";

/**
 * Stamp width per star band, in screen px. A lot is 4 world units = 144px
 * wide, so even the L landmarks stay near their own pad and the S sheds
 * read smaller than the towers — every building is one of three sizes.
 */
export function buildingTargetWidth(band: CityLot["buildingBand"]): number {
  return BUILDING_WIDTH[band];
}

function buildingStamp(lot: CityLot, x: number, y: number, stamp: StampFn): string {
  const sheet = sheetForBand(lot.buildingBand);
  const box = spriteBoxFor(lot.buildingId);
  const anchor = project(x + 1, y + LOT_D / 2);
  return stamp(
    sheet.file,
    sheet,
    box,
    anchor.sx,
    anchor.sy,
    buildingTargetWidth(lot.buildingBand),
    !lot.recentActivity,
  );
}

export function placeLots(lots: CityLot[], options: PlanOptions = {}): LotPlacement[] {
  return planCity(lots, options).placements;
}

function ease(inner: string, cx: number, cy: number, sx: number, sy: number): string {
  return (
    `<g transform="translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(sx)} ${fmt(sy)}) ` +
    `translate(${fmt(-cx)} ${fmt(-cy)})">${inner}</g>`
  );
}

function lotTile(place: LotPlacement, index: number, stamp: StampFn): string {
  const { lot, x, y } = place;
  const worked = lot.yard === "fully_dormant" || lot.yard.startsWith("prs_");
  const tile: SpriteBox = worked
    ? LOT_TILE_DIRT
    : LOT_TILE_GRASS[index % LOT_TILE_GRASS.length];
  const bed = worked ? "#c9a06b" : "#8fc46a";
  let s = diamond(x + 0.15, y + 0.15, LOT_W - 0.3, LOT_D - 0.3, bed, "rgba(40,60,35,0.18)");
  const bc = project(x + LOT_W / 2, y + LOT_D);
  const naturalW = tile.w;
  const inner = stamp(
    GROUND_SHEET.file,
    GROUND_SHEET,
    tile,
    bc.sx,
    bc.sy,
    naturalW,
    false,
  );
  s += ease(
    inner,
    bc.sx,
    bc.sy,
    ((LOT_W + LOT_D) * 36) / naturalW,
    ((LOT_W + LOT_D) * 18) / tile.h,
  );
  return s;
}

const FOREST_TREES = WILD_TREES.filter((box) => box.h >= 50);
const FOREST_BUSHES = WILD_BUSHES.filter((box) => box.w <= 64);
const FOREST_STEP = 2.2;
const WILD_APRON = 10;

function wildItems(plan: CityPlan, stamp: StampFn): Array<{ key: number; svg: string }> {
  const items: Array<{ key: number; svg: string }> = [];
  const { minX, minY, maxX, maxY } = plan.bounds;
  let iy = 0;
  for (let y = minY - WILD_APRON; y <= maxY + WILD_APRON; y += FOREST_STEP, iy++) {
    let ix = 0;
    for (let x = minX - WILD_APRON; x <= maxX + WILD_APRON; x += FOREST_STEP, ix++) {
      if (x >= minX - 0.4 && x <= maxX + 0.4 && y >= minY - 0.4 && y <= maxY + 0.4) continue;
      if (hash01(ix, iy, 11) < 0.22) continue;
      const jx = x + (hash01(ix, iy, 67) - 0.5) * 0.7;
      const jy = y + (hash01(ix, iy, 71) - 0.5) * 0.7;
      const anchor = project(jx, jy);
      const variant = hash01(ix, iy, 37);
      const size = hash01(ix, iy, 53);
      if (hash01(ix, iy, 23) < 0.72) {
        const box = FOREST_TREES[Math.floor(variant * FOREST_TREES.length) % FOREST_TREES.length];
        const targetH = 70 + size * 48;
        const targetW = (box.w * targetH) / box.h;
        items.push({
          key: jx + jy,
          svg: `<g class="wild-tree">${stamp(WILD_SHEETS.trees.file, WILD_SHEETS.trees, box, anchor.sx, anchor.sy, targetW, false)}</g>`,
        });
      } else {
        const box = FOREST_BUSHES[Math.floor(variant * FOREST_BUSHES.length) % FOREST_BUSHES.length];
        const targetH = 28 + size * 20;
        const targetW = (box.w * targetH) / box.h;
        items.push({
          key: jx + jy,
          svg: `<g class="wild-bush">${stamp(WILD_SHEETS.bushes.file, WILD_SHEETS.bushes, box, anchor.sx, anchor.sy, targetW, false)}</g>`,
        });
      }
    }
  }
  return items;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hitTile(place: LotPlacement): string {
  return `<g class="lot-hit" data-repo="${escapeXml(place.lot.fullName)}">${diamond(place.x, place.y, 4, LOT_D, "rgba(0,0,0,0)", "rgba(0,0,0,0)")}</g>`;
}

export function lotGroup(place: LotPlacement, i: number): string {
  const { lot, x, y } = place;
  const tip = [
    lot.fullName,
    `${lot.stars} stars · ${lot.openIssues} issues · ${lot.openPrs} PRs`,
    lot.yard,
    lot.occupantClass,
  ].join(" — ");
  const stamp = stamper(i);
  const body = place.constructing
    ? constructionSite(place, stamp, `lot${i}`)
    : `${buildingStamp(lot, x, y, stamp)}${renderYardProps(x, y, lot, stamp, `lot${i}`)}`;
  return `
    <g class="lot${place.constructing ? " constructing" : ""}" data-repo="${escapeXml(lot.fullName)}" data-yard="${lot.yard}" data-band="${lot.buildingBand}" data-occupant="${lot.occupantClass}" data-size="${lot.buildingBand}" data-district="${escapeXml(place.district)}">
      <title>${escapeXml(tip)}</title>
      ${body}
    </g>`;
}

function streetWalkers(sy: number, minX: number, maxX: number, plan: CityPlan): string {
  const cy = sy * STRIDE_Y - 0.35 - 1.0 + 0.5;
  const east = ((sy % 2) + 2) % 2 === 0;
  const wx = east ? minX + 2.4 : maxX - 2.4;
  const anchor = project(wx, cy);
  const dx = east ? 110 : -110;
  // Human-leaning streets get bipeds; robot-leaning streets get a rover gait.
  const robotStreet = plan.placements.filter((p) => p.row === sy && p.lot.occupantClass === "robot").length >
    plan.placements.filter((p) => p.row === sy && p.lot.occupantClass === "human").length;
  if (robotStreet) {
    return `<g class="road-life" data-class="robot">${animatedFigure({
      id: `street-${sy}`,
      sheet: animSheet("quadDog"),
      anchorX: anchor.sx,
      anchorY: anchor.sy,
      targetW: 50,
      phase: -sy * 1.3,
      pace: { dx, dy: dx / 2, legs: 3 },
    })}</g>`;
  }
  return `<g class="road-life" data-class="human">${pacingHuman(
    `street-h-${sy}`,
    anchor.sx,
    anchor.sy,
    Math.abs(sy),
    dx,
    dx / 2,
  )}${animatedFigure({
    id: `street-${sy}`,
    sheet: animSheet(east ? "unitWalk" : "carryCrate"),
    anchorX: anchor.sx + (east ? -30 : 30),
    anchorY: anchor.sy + 6,
    targetW: 48,
    phase: -sy * 1.3,
    pace: { dx: dx * 0.85, dy: (dx * 0.85) / 2, legs: 3 },
  })}</g>`;
}

function grassPattern(): string {
  return `<defs>
    <pattern id="iso-grass" patternUnits="userSpaceOnUse" width="${TILE_W}" height="${TILE_H}">
      <rect width="${TILE_W}" height="${TILE_H}" fill="#7fbe56"/>
      <path d="M${TILE_W / 2} 0 L${TILE_W} ${TILE_H / 2} L${TILE_W / 2} ${TILE_H} L0 ${TILE_H / 2} Z" fill="#86c55c" stroke="rgba(40,70,30,0.14)" stroke-width="0.7"/>
    </pattern>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f4f1ea"/>
      <stop offset="100%" stop-color="#e8eef1"/>
    </linearGradient>
  </defs>`;
}

export function renderCitySvg(
  lots: CityLot[],
  generatedAt: string,
  options: PlanOptions = {},
): string {
  const plan = planCity(lots, options);
  return renderPlannedCity(plan, generatedAt);
}

export function renderPlannedCity(plan: CityPlan, generatedAt: string): string {
  const { placements, bounds } = plan;
  const min = project(bounds.minX, bounds.maxY);
  const max = project(bounds.maxX, bounds.minY);
  const bottom = project(bounds.maxX, bounds.maxY);
  const pad = 90;
  const vbX = min.sx - pad;
  const vbY = -260;
  const vbW = max.sx - min.sx + pad * 2;
  const vbH = bottom.sy - vbY + 90;
  const sorted = [...placements].sort((a, b) => a.x + a.y - (b.x + b.y));

  const groundStamp = stamper(placements.length + 1);
  const featureStamp = stamper(placements.length + 3);

  const items: Array<{ key: number; svg: string }> = sorted.map((place, i) => ({
    key: place.x + place.y,
    svg: lotGroup(place, i),
  }));
  for (const sy of plan.streetRows) {
    const east = ((sy % 2) + 2) % 2 === 0;
    const wx = east ? bounds.minX + 2.4 : bounds.maxX - 2.4;
    items.push({
      key: wx + sy * STRIDE_Y,
      svg: streetWalkers(sy, bounds.minX, bounds.maxX, plan),
    });
  }
  items.push(...wildItems(plan, groundStamp));
  items.sort((a, b) => a.key - b.key);

  const streets = plan.streetRows
    .map((sy) => localStreet(sy, bounds.minX, bounds.maxX, groundStamp))
    .join("");
  const vacancies = plan.vacancies.map((v) => renderVacant(v, groundStamp)).join("");

  const worldAttr = `${fmt(vbX - 80000)} ${fmt(vbY - 80000)} 160000 160000`;
  const developed = `${fmt(bounds.minX)} ${fmt(bounds.minY)} ${fmt(bounds.maxX)} ${fmt(bounds.maxY)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg id="axp-map" xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" data-world="${worldAttr}" data-developed="${developed}" data-infinite="1" data-tile="${TILE_W} ${TILE_H}" role="img" aria-label="AXP City isometric map generated ${generatedAt}">
  ${grassPattern()}
  <rect class="infinite-fill" x="-80000" y="-80000" width="160000" height="160000" fill="url(#iso-grass)"/>
  <g id="infinite-ground" class="infinite-ground"></g>
  <g font-family="ui-sans-serif, system-ui, sans-serif">
    <g class="ground">
      ${renderFeatures(plan, featureStamp)}
      ${streets}
      ${vacancies}
      ${sorted.map((place, i) => lotTile(place, i, groundStamp)).join("")}
    </g>
    <g id="city-items">
    ${items.map((it) => it.svg).join("\n")}
    </g>
    ${renderAirLayer(vbX, vbY, vbW, Math.min(120, vbH * 0.2))}
    <g class="hits">
    ${sorted.map(hitTile).join("\n")}
    </g>
  </g>
</svg>`;
}

export function cityBounds(): { tileW: number; tileH: number } {
  return { tileW: TILE_W, tileH: TILE_H };
}

export function planSnapshot(plan: CityPlan) {
  return {
    bounds: plan.bounds,
    slotBounds: plan.slotBounds,
    features: plan.features,
    streetRows: plan.streetRows,
    radius: plan.radius,
    lots: plan.placements.map((p) => ({
      repo: p.lot.fullName,
      url: p.lot.url,
      stars: p.lot.stars,
      issues: p.lot.openIssues,
      prs: p.lot.openPrs,
      band: p.lot.buildingBand,
      id: p.lot.buildingId,
      yard: p.lot.yard.replaceAll("_", " "),
      occupant: p.lot.occupantClass,
      constructing: p.constructing,
      district: p.district,
      x: p.x,
      y: p.y,
      col: p.col,
      row: p.row,
      props: [
        p.lot.showBlueprint ? "blueprint" : "",
        p.lot.showDraftingTable ? "table" : "",
        p.lot.showMaterials ? "materials" : "",
        p.lot.showCrew ? "crew" : "",
        p.lot.showDrone ? "drone" : "",
      ].filter(Boolean),
    })),
  };
}
