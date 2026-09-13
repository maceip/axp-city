import type { CityLot } from "../types.js";
import { animatedFigure } from "./anim.js";
import { diamond, fmt, project, TILE_H, TILE_W } from "./iso.js";
import {
  renderYardProps,
  spriteBench,
  spriteLamp,
  spriteTree,
} from "./props.js";
import {
  animSheet,
  CONE_TILE,
  GROUND_SHEET,
  LOT_TILE_DIRT,
  LOT_TILE_GRASS,
  MANHOLE_TILE,
  ROAD_TILES,
  sheetForBand,
  spriteBoxFor,
  stamper,
  WILD_BUSHES,
  WILD_SHEETS,
  WILD_TREES,
  WILD_WATER,
  type SpriteBox,
  type StampFn,
} from "./sprites.js";

/** Real sprite art from assets/city-sprites (flood-keyed, occluding stamps). */

/**
 * Stamp width per star band, in screen px. A lot is 4 world units = 144px
 * wide, so even the L landmarks stay near their own pad and the S sheds
 * read smaller than the towers — size follows stars, not sprite art.
 */
export function buildingTargetWidth(band: CityLot["buildingBand"]): number {
  switch (band) {
    case "S":
      return 112;
    case "M":
      return 138;
    case "L":
      return 168;
  }
}

function buildingStamp(lot: CityLot, x: number, y: number, stamp: StampFn): string {
  const sheet = sheetForBand(lot.buildingBand);
  const box = spriteBoxFor(lot.buildingId);
  // Plant bottom-center on the building pad (first diamond half).
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

const COLS = 4;
const LOT_W = 4;
const LOT_D = 2.4;
// Streets are real tile stamps ~1 world unit wide, so the row gap leaves a
// grass shoulder on each side: shoulder + road + shoulder.
const ROAD_D = 1.0;
const SHOULDER = 0.35;
const STRIDE_X = 4.7;
const STRIDE_Y = LOT_D + ROAD_D + SHOULDER * 2;
const MARGIN = 1.4;
const ROAD_TOP0 = MARGIN - SHOULDER - ROAD_D;

function roadCenterY(row: number): number {
  return ROAD_TOP0 + row * STRIDE_Y + ROAD_D / 2;
}

// Tile ground extends past the developed island so the camera can roam over
// art instead of void. The wild ring below covers this apron.
const FOREST_PAD_X = 6;
const FOREST_PAD_Y = 4;
const FOREST_STEP = 1.7;
// Tallest stamps rise ~260px above their anchors; keep them inside.
const VB_Y = -240;

// Measured boxes 0-1 are sheet UI thumbnails, not trees; the full-width bush
// row is a hedge strip rather than a plantable bush.
const FOREST_TREES = WILD_TREES.filter((box) => box.h >= 50);
const FOREST_BUSHES = WILD_BUSHES.filter((box) => box.w <= 64);

/** Deterministic 0-1 hash for stable foliage variety (no RNG in renders). */
function hash01(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed, 974634211);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface LotPlacement {
  lot: CityLot;
  col: number;
  row: number;
  x: number;
  y: number;
}

export function placeLots(lots: CityLot[]): LotPlacement[] {
  return lots.map((lot, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return {
      lot,
      col,
      row,
      x: MARGIN + col * STRIDE_X,
      y: MARGIN + row * STRIDE_Y,
    };
  });
}

function worldSize(count: number): { w: number; h: number; rows: number } {
  const rows = Math.max(1, Math.ceil(count / COLS));
  return {
    rows,
    w: MARGIN + COLS * STRIDE_X + 0.8,
    h: MARGIN + rows * STRIDE_Y + 0.6,
  };
}

/**
 * Non-uniform scale about a screen point. The ground-kit art is drawn
 * flatter than true 2:1, so lot tiles are eased to the projected footprint
 * instead of stamped at natural aspect.
 */
function ease(inner: string, cx: number, cy: number, sx: number, sy: number): string {
  return (
    `<g transform="translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(sx)} ${fmt(sy)}) ` +
    `translate(${fmt(-cx)} ${fmt(-cy)})">${inner}</g>`
  );
}

/** One street run from the road tiles: alternating slabs, ironwork, a cone. */
function streetRun(row: number, w: number, stamp: StampFn): string {
  const top = ROAD_TOP0 + row * STRIDE_Y;
  const cy = top + ROAD_D / 2;
  let s = diamond(0.6, top, w - 1.2, ROAD_D, "#4b525c", "rgba(20,24,28,0.25)");
  let k = 0;
  for (let x = 1.2; x < w - 1.2; x += 1.0, k++) {
    const anchor = project(x, cy);
    if (k % 6 === 3) {
      s += stamp(
        GROUND_SHEET.file,
        GROUND_SHEET,
        MANHOLE_TILE,
        anchor.sx,
        anchor.sy,
        30,
        false,
      );
    }
    const tile = ROAD_TILES[k % ROAD_TILES.length];
    const inner = stamp(
      GROUND_SHEET.file,
      GROUND_SHEET,
      tile,
      anchor.sx,
      anchor.sy,
      72,
      false,
    );
    // Kit slabs read a touch taller than the bed; settle them onto it.
    s += ease(inner, anchor.sx, anchor.sy, 1, 0.85);
  }
  const cone = project(w - 2.6 - (row % 2) * (w - 5.2), cy);
  s += stamp(
    GROUND_SHEET.file,
    GROUND_SHEET,
    CONE_TILE,
    cone.sx,
    cone.sy,
    26,
    false,
  );
  return s;
}

/**
 * One connected pad+yard per lot from the dual-plot tiles (dirt receiving
 * yards for material/PR and dormant lots, grass for planning/idle ones), so
 * the building pad and the activity yard read as a single property. A muted
 * flat bed sits underneath as a loading fallback.
 */
function lotTile(place: LotPlacement, index: number, stamp: StampFn): string {
  const { lot, x, y } = place;
  const worked =
    lot.yard === "fully_dormant" || lot.yard.startsWith("prs_");
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
  // Projected lot footprint: (LOT_W+LOT_D)*36 wide, (LOT_W+LOT_D)*18 tall.
  s += ease(
    inner,
    bc.sx,
    bc.sy,
    ((LOT_W + LOT_D) * 36) / naturalW,
    ((LOT_W + LOT_D) * 18) / tile.h,
  );
  return s;
}

function worldBounds(w: number, h: number): { x: number; y: number; width: number; height: number } {
  const x0 = -FOREST_PAD_X;
  const y0 = -FOREST_PAD_Y;
  const x1 = w + FOREST_PAD_X;
  const y1 = h + FOREST_PAD_Y;
  const sx0 = (x0 - y1) * (TILE_W / 2);
  const sx1 = (x1 - y0) * (TILE_W / 2);
  const sy1 = (x1 + y1) * (TILE_H / 2) + 80;
  return { x: sx0, y: VB_Y, width: sx1 - sx0, height: sy1 - VB_Y };
}

/**
 * Forest ring from the new wild sheets. Items are height-normalized so pixel
 * trees/bushes share world scale, then depth-sorted with lots and walkers.
 */
function forestItems(w: number, h: number, stamp: StampFn): Array<{ key: number; svg: string }> {
  const items: Array<{ key: number; svg: string }> = [];
  let iy = 0;
  for (let y = -FOREST_PAD_Y; y <= h + FOREST_PAD_Y; y += FOREST_STEP, iy++) {
    let ix = 0;
    for (let x = -FOREST_PAD_X; x <= w + FOREST_PAD_X; x += FOREST_STEP, ix++) {
      if (x > -1 && x < w + 1 && y > -1 && y < h + 1) continue;
      if (hash01(ix, iy, 11) < 0.16) continue;
      const jx = x + (hash01(ix, iy, 67) - 0.5) * 0.7;
      const jy = y + (hash01(ix, iy, 71) - 0.5) * 0.7;
      const anchor = project(jx, jy);
      const variant = hash01(ix, iy, 37);
      const size = hash01(ix, iy, 53);
      if (hash01(ix, iy, 23) < 0.62) {
        const box = FOREST_TREES[Math.floor(variant * FOREST_TREES.length) % FOREST_TREES.length];
        const targetH = 76 + size * 52;
        const targetW = (box.w * targetH) / box.h;
        items.push({
          key: jx + jy,
          svg: `<g class="wild-tree">${stamp(WILD_SHEETS.trees.file, WILD_SHEETS.trees, box, anchor.sx, anchor.sy, targetW, false)}</g>`,
        });
      } else {
        const box = FOREST_BUSHES[Math.floor(variant * FOREST_BUSHES.length) % FOREST_BUSHES.length];
        const targetH = 30 + size * 22;
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

function groundLayer(placements: LotPlacement[], stamp: StampFn): string {
  const { w, h, rows } = worldSize(placements.length);
  let s = "";
  s += diamond(-FOREST_PAD_X, -FOREST_PAD_Y, w + FOREST_PAD_X * 2, h + FOREST_PAD_Y * 2, "#7fbe56", "rgba(40,70,30,0.16)");
  s += diamond(-FOREST_PAD_X + 0.35, -FOREST_PAD_Y + 0.35, w + FOREST_PAD_X * 2 - 0.7, h + FOREST_PAD_Y * 2 - 0.7, "#86c55c", "rgba(40,70,30,0.08)");

  for (let r = 0; r <= rows; r++) {
    s += streetRun(r, w, stamp);
  }

  s += diamond(w - 2.2, h - 2.0, 2.0, 1.7, "#4ea2d6", "rgba(20,70,110,0.2)");
  const pond = project(w - 0.2, h - 0.3);
  s += stamp(WILD_SHEETS.bushes.file, WILD_SHEETS.bushes, WILD_WATER, pond.sx, pond.sy, 132, false);

  placements.forEach((place, i) => {
    s += lotTile(place, i, stamp);
  });
  return `<g class="ground">${s}</g>`;
}

function decorLayer(placements: LotPlacement[], stamp: StampFn): string {
  const { w, h } = worldSize(placements.length);
  let s = "";
  const trees: Array<[number, number]> = [
    [0.45, 0.45],
    [w - 1.1, 0.5],
    [0.5, h - 1.3],
    [w - 2.6, h - 2.3],
  ];
  trees.forEach(([x, y], i) => {
    s += spriteTree(x, y, i, stamp);
  });
  s += spriteLamp(MARGIN + STRIDE_X - 0.35, MARGIN - 0.45, stamp);
  s += spriteLamp(MARGIN + 2 * STRIDE_X - 0.35, MARGIN - 0.45, stamp);
  s += spriteBench(MARGIN + STRIDE_X + 0.15, MARGIN + LOT_D + 0.15, stamp);
  return `<g class="decor">${s}</g>`;
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

function lotGroup(place: LotPlacement, i: number): string {
  const { lot, x, y } = place;
  const tip = [
    lot.fullName,
    `${lot.stars} stars · ${lot.openIssues} issues · ${lot.openPrs} PRs`,
    lot.yard,
  ].join(" — ");
  const stamp = stamper(i);
  return `
    <g class="lot" data-repo="${escapeXml(lot.fullName)}" data-yard="${lot.yard}" data-band="${lot.buildingBand}">
      <title>${escapeXml(tip)}</title>
      ${buildingStamp(lot, x, y, stamp)}
      ${renderYardProps(x, y, lot, stamp, `lot${i}`)}
    </g>`;
}

/**
 * Crew on the streets: one pacer per road gliding along world +x (or -x on
 * alternating streets) so feet stay on the asphalt, mirrored at each end.
 * Emitted as its own layer so depth sorting can interleave it with the lots.
 */
function streetWalkers(row: number, w: number): string {
  const cy = roadCenterY(row);
  const east = row % 2 === 0;
  const wx = east ? 2.4 : w - 2.4;
  const anchor = project(wx, cy);
  const dx = east ? 100 : -100;
  return `<g class="road-life">${animatedFigure({
    id: `street-${row}`,
    sheet: animSheet(east ? "unitWalk" : "carryCrate"),
    anchorX: anchor.sx,
    anchorY: anchor.sy,
    targetW: 50,
    phase: -row * 1.3,
    pace: { dx, dy: dx / 2, legs: 3 },
  })}</g>`;
}

export function renderCitySvg(lots: CityLot[], generatedAt: string): string {
  const placements = placeLots(lots);
  const { w, h, rows } = worldSize(lots.length);
  const min = project(0, h);
  const max = project(w, 0);
  const bottom = project(w, h);
  const pad = 70;
  const vbX = min.sx - pad;
  const vbY = VB_Y;
  const vbW = max.sx - min.sx + pad * 2;
  const vbH = bottom.sy - vbY + 80;
  const world = worldBounds(w, h);
  const sorted = [...placements].sort((a, b) => a.x + a.y - (b.x + b.y));

  // Ground and decor stamps share stampers past the per-lot range (0..n-1).
  const groundStamp = stamper(placements.length + 1);
  const decorStamp = stamper(placements.length);
  // Lots and street walkers depth-sort together: a walker on the street
  // behind a row is occluded by that row's buildings, like everything else.
  const items: Array<{ key: number; svg: string }> = sorted.map((place, i) => ({
    key: place.x + place.y,
    svg: lotGroup(place, i),
  }));
  for (let r = 0; r <= rows; r++) {
    const east = r % 2 === 0;
    items.push({
      key: (east ? 2.4 : w - 2.4) + roadCenterY(r),
      svg: streetWalkers(r, w),
    });
  }
  items.push(...forestItems(w, h, groundStamp));
  items.sort((a, b) => a.key - b.key);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg id="axp-map" xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" data-world="${fmt(world.x)} ${fmt(world.y)} ${fmt(world.width)} ${fmt(world.height)}" role="img" aria-label="AXP City isometric map generated ${generatedAt}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f4f1ea"/>
      <stop offset="100%" stop-color="#e8eef1"/>
    </linearGradient>
  </defs>
  <rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="url(#sky)"/>
  <g font-family="ui-sans-serif, system-ui, sans-serif">
    ${groundLayer(placements, groundStamp)}
    ${decorLayer(placements, decorStamp)}
    ${items.map((it) => it.svg).join("\n")}
    <g class="hits">
    ${sorted.map(hitTile).join("\n")}
    </g>
  </g>
</svg>`;
}

export function cityBounds(): { tileW: number; tileH: number } {
  return { tileW: TILE_W, tileH: TILE_H };
}
