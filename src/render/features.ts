import type { CityFeature, CityPlan, VacantPlot } from "../world/layout.js";
import { LOT_D, LOT_W, STRIDE_Y } from "../world/constants.js";
import { hash01 } from "../world/hash.js";
import { humanFigure, pacingHuman } from "./humans.js";
import { diamond, fmt, project } from "./iso.js";
import {
  DECOR_BENCH,
  DECOR_LAMP,
  DECOR_TREES,
  GROUND_SHEET,
  GROUND_TILES,
  LOT_TILE_DIRT,
  LOT_TILE_GRASS,
  ROAD_TILES,
  type StampFn,
  type SpriteBox,
} from "./sprites.js";

// Named park grass tile — alias of the kit cell.
const PARK_TILE: SpriteBox = GROUND_TILES.parkGrass;
const WATER_TILE: SpriteBox = GROUND_TILES.waterTile;
const SAND_TILE: SpriteBox = GROUND_TILES.sandTile;
const ROAD_CROSS: SpriteBox = GROUND_TILES.roadCross;
const ASPHALT: SpriteBox = GROUND_TILES.asphaltSlab;

function stampAt(
  stamp: StampFn,
  box: SpriteBox,
  x: number,
  y: number,
  w: number,
): string {
  const a = project(x, y);
  return stamp(GROUND_SHEET.file, GROUND_SHEET, box, a.sx, a.sy, w, false);
}

function ease(inner: string, cx: number, cy: number, sx: number, sy: number): string {
  return (
    `<g transform="translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(sx)} ${fmt(sy)}) ` +
    `translate(${fmt(-cx)} ${fmt(-cy)})">${inner}</g>`
  );
}

function renderPark(feature: CityFeature, stamp: StampFn): string {
  let s = diamond(feature.x, feature.y, feature.w, feature.h, "#6fb85a", "rgba(30,70,30,0.2)");
  const step = 1.6;
  let iy = 0;
  for (let y = feature.y + 0.4; y < feature.y + feature.h - 0.4; y += step, iy++) {
    let ix = 0;
    for (let x = feature.x + 0.4; x < feature.x + feature.w - 0.4; x += step, ix++) {
      const roll = hash01(ix, iy, 3);
      if (roll < 0.18) {
        const tree = DECOR_TREES[(ix + iy) % DECOR_TREES.length];
        s += stampAt(stamp, tree, x, y, 54 + roll * 18);
      } else if (roll < 0.28) {
        s += stampAt(stamp, DECOR_BENCH, x, y, 64);
      } else if (roll < 0.34) {
        s += stampAt(stamp, DECOR_LAMP, x, y, 24);
      } else {
        s += stampAt(stamp, PARK_TILE, x, y, 48);
      }
    }
  }
  const pondX = feature.x + feature.w * 0.62;
  const pondY = feature.y + feature.h * 0.55;
  s += diamond(pondX, pondY, 2.2, 1.5, "#4ea2d6", "rgba(20,70,110,0.25)");
  s += stampAt(stamp, WATER_TILE, pondX + 1.1, pondY + 1.2, 90);
  s += stampAt(stamp, SAND_TILE, pondX - 0.2, pondY + 0.2, 48);
  // Park-goers: humans, never robots.
  const p1 = project(feature.x + 1.4, feature.y + 1.1);
  const p2 = project(feature.x + feature.w * 0.45, feature.y + feature.h * 0.7);
  const p3 = project(feature.x + feature.w * 0.75, feature.y + 1.6);
  s += pacingHuman("park-1", p1.sx, p1.sy, 0, 70, 32);
  s += humanFigure("park-2", p2.sx, p2.sy, 1, "wave");
  s += pacingHuman("park-3", p3.sx, p3.sy, 2, -55, 24);
  return `<g class="city-feature city-park" data-feature="central-park">${s}</g>`;
}

function renderFreeway(feature: CityFeature, stamp: StampFn): string {
  let s = diamond(feature.x, feature.y, feature.w, feature.h, "#4b525c", "rgba(20,24,28,0.3)");
  let k = 0;
  for (let x = feature.x + 0.6; x < feature.x + feature.w - 0.6; x += 1.1, k++) {
    const cy = feature.y + feature.h * 0.5;
    const a = project(x, cy);
    const tile = k % 7 === 3 ? ROAD_CROSS : ASPHALT;
    const inner = stamp(GROUND_SHEET.file, GROUND_SHEET, tile, a.sx, a.sy, 70, false);
    s += ease(inner, a.sx, a.sy, 1.05, 0.72);
  }
  // Lane dash in screen space along the strip center.
  const a0 = project(feature.x + 0.4, feature.y + feature.h * 0.5);
  const a1 = project(feature.x + feature.w - 0.4, feature.y + feature.h * 0.5);
  s += `<line x1="${fmt(a0.sx)}" y1="${fmt(a0.sy)}" x2="${fmt(a1.sx)}" y2="${fmt(a1.sy)}" stroke="#d4c36a" stroke-width="2" stroke-dasharray="10 14" opacity="0.85"/>`;
  // Simple cars gliding the freeway.
  s += freewayCar("fw-car-1", a0.sx, a0.sy, a1.sx - a0.sx, a1.sy - a0.sy, 0, "#c45c26");
  s += freewayCar("fw-car-2", a1.sx, a1.sy, a0.sx - a1.sx, a0.sy - a1.sy, 4, "#2a6f97");
  s += freewayCar("fw-car-3", a0.sx, a0.sy, a1.sx - a0.sx, a1.sy - a0.sy, 9, "#d9e4ee");
  return `<g class="city-feature city-freeway" data-feature="north-freeway">${s}</g>`;
}

function freewayCar(
  id: string,
  x: number,
  y: number,
  dx: number,
  dy: number,
  delay: number,
  color: string,
): string {
  return (
    `<g class="freeway-car">` +
    `<g>` +
    `<animateTransform attributeName="transform" type="translate" ` +
    `values="${fmt(x)} ${fmt(y)};${fmt(x + dx)} ${fmt(y + dy)}" dur="${fmt(16 + delay)}s" begin="${delay}s" repeatCount="indefinite"/>` +
    `<rect x="-10" y="-5" width="20" height="9" rx="2" fill="${color}" stroke="#222" stroke-width="0.6"/>` +
    `<rect x="-4" y="-8" width="10" height="5" rx="1" fill="#9ad0ea" opacity="0.85"/>` +
    `</g></g>`
  );
}

function renderTram(feature: CityFeature, stamp: StampFn): string {
  let s = diamond(feature.x, feature.y, feature.w, feature.h, "#8d949c", "rgba(30,30,30,0.2)");
  const cx = feature.x + feature.w / 2;
  const y0 = feature.y + 0.3;
  const y1 = feature.y + feature.h - 0.3;
  const r0a = project(cx - 0.12, y0);
  const r0b = project(cx - 0.12, y1);
  const r1a = project(cx + 0.12, y0);
  const r1b = project(cx + 0.12, y1);
  s += `<line x1="${fmt(r0a.sx)}" y1="${fmt(r0a.sy)}" x2="${fmt(r0b.sx)}" y2="${fmt(r0b.sy)}" stroke="#3a3f46" stroke-width="2.4"/>`;
  s += `<line x1="${fmt(r1a.sx)}" y1="${fmt(r1a.sy)}" x2="${fmt(r1b.sx)}" y2="${fmt(r1b.sy)}" stroke="#3a3f46" stroke-width="2.4"/>`;
  // Ties
  for (let y = y0; y < y1; y += 0.7) {
    const a = project(cx - 0.28, y);
    const b = project(cx + 0.28, y);
    s += `<line x1="${fmt(a.sx)}" y1="${fmt(a.sy)}" x2="${fmt(b.sx)}" y2="${fmt(b.sy)}" stroke="#6b5340" stroke-width="2"/>`;
  }
  const stations = [0.15, 0.5, 0.85];
  for (const t of stations) {
    const sy = y0 + (y1 - y0) * t;
    s += stampAt(stamp, DECOR_LAMP, cx + 0.45, sy, 24);
    s += stampAt(stamp, DECOR_BENCH, cx - 0.55, sy, 70);
  }
  const start = project(cx, y0);
  const end = project(cx, y1);
  s += tramCar(start.sx, start.sy, end.sx - start.sx, end.sy - start.sy);
  return `<g class="city-feature city-tram" data-feature="tram-line">${s}</g>`;
}

function tramCar(x: number, y: number, dx: number, dy: number): string {
  return (
    `<g class="tram-car">` +
    `<g>` +
    `<animateTransform attributeName="transform" type="translate" ` +
    `values="${fmt(x)} ${fmt(y)};${fmt(x + dx)} ${fmt(y + dy)};${fmt(x)} ${fmt(y)}" ` +
    `keyTimes="0;0.5;1" dur="22s" repeatCount="indefinite"/>` +
    `<rect x="-8" y="-14" width="16" height="18" rx="2" fill="#c45c26" stroke="#3a2010" stroke-width="0.7"/>` +
    `<rect x="-6" y="-11" width="5" height="5" fill="#9ad0ea"/>` +
    `<rect x="1" y="-11" width="5" height="5" fill="#9ad0ea"/>` +
    `<rect x="-5" y="2" width="10" height="3" fill="#2b2f36"/>` +
    `</g></g>`
  );
}

function renderRiver(feature: CityFeature, stamp: StampFn): string {
  let s = diamond(feature.x, feature.y, feature.w, feature.h, "#4ea2d6", "rgba(20,70,110,0.28)");
  for (let y = feature.y + 0.5; y < feature.y + feature.h; y += 1.8) {
    s += stampAt(stamp, WATER_TILE, feature.x + feature.w * 0.55, y, 70);
  }
  return `<g class="city-feature city-river" data-feature="west-river">${s}</g>`;
}

function renderPlaza(feature: CityFeature, stamp: StampFn): string {
  let s = diamond(feature.x, feature.y, feature.w, feature.h, "#c4b49a", "rgba(60,50,30,0.2)");
  s += stampAt(stamp, DECOR_BENCH, feature.x + 0.8, feature.y + 0.8, 72);
  s += stampAt(stamp, DECOR_LAMP, feature.x + feature.w * 0.7, feature.y + 1.1, 26);
  s += stampAt(stamp, DECOR_TREES[0], feature.x + 0.5, feature.y + feature.h * 0.7, 58);
  const a = project(feature.x + feature.w * 0.5, feature.y + feature.h * 0.45);
  s += humanFigure("plaza-1", a.sx, a.sy, 4, "wave");
  return `<g class="city-feature city-plaza" data-feature="tram-park-plaza">${s}</g>`;
}

export function renderVacant(plot: VacantPlot, stamp: StampFn): string {
  const tile =
    plot.variant === "dirt"
      ? LOT_TILE_DIRT
      : LOT_TILE_GRASS[Math.abs(plot.sx + plot.sy) % LOT_TILE_GRASS.length];
  const bed = plot.variant === "dirt" ? "#c9a06b" : "#8fc46a";
  let s = diamond(plot.x + 0.2, plot.y + 0.2, LOT_W - 0.4, LOT_D - 0.4, bed, "rgba(40,60,35,0.16)");
  const bc = project(plot.x + LOT_W / 2, plot.y + LOT_D);
  const inner = stamp(GROUND_SHEET.file, GROUND_SHEET, tile, bc.sx, bc.sy, tile.w, false);
  s += ease(
    inner,
    bc.sx,
    bc.sy,
    ((LOT_W + LOT_D) * 36) / tile.w,
    ((LOT_W + LOT_D) * 18) / tile.h,
  );
  if (plot.variant === "trees") {
    s += stampAt(stamp, DECOR_TREES[Math.abs(plot.sx) % DECOR_TREES.length], plot.x + 1.2, plot.y + 1.1, 58);
    s += stampAt(stamp, DECOR_TREES[Math.abs(plot.sy) % DECOR_TREES.length], plot.x + 2.6, plot.y + 0.7, 50);
  }
  if (plot.variant === "plaza") {
    s += stampAt(stamp, DECOR_BENCH, plot.x + 1.5, plot.y + 1.0, 70);
    s += stampAt(stamp, DECOR_LAMP, plot.x + 3.2, plot.y + 0.5, 24);
  }
  return `<g class="vacant-plot" data-slot="${plot.sx},${plot.sy}">${s}</g>`;
}

export function renderFeatures(plan: CityPlan, stamp: StampFn): string {
  const byKind: Record<string, (f: CityFeature) => string> = {
    river: (f) => renderRiver(f, stamp),
    freeway: (f) => renderFreeway(f, stamp),
    park: (f) => renderPark(f, stamp),
    tram: (f) => renderTram(f, stamp),
    plaza: (f) => renderPlaza(f, stamp),
  };
  let s = "";
  for (const feature of plan.features) {
    const draw = byKind[feature.kind];
    if (draw) s += draw(feature);
  }
  return s;
}

export function localStreet(
  sy: number,
  minX: number,
  maxX: number,
  stamp: StampFn,
): string {
  const top = sy * STRIDE_Y - 0.35 - 1.0;
  const cy = top + 0.5;
  let s = diamond(minX + 0.4, top, maxX - minX - 0.8, 1.0, "#4b525c", "rgba(20,24,28,0.25)");
  let k = 0;
  for (let x = minX + 1.0; x < maxX - 1.0; x += 1.0, k++) {
    const anchor = project(x, cy);
    const tile = ROAD_TILES[k % ROAD_TILES.length];
    const inner = stamp(GROUND_SHEET.file, GROUND_SHEET, tile, anchor.sx, anchor.sy, 72, false);
    s += ease(inner, anchor.sx, anchor.sy, 1, 0.85);
  }
  return `<g class="street" data-row="${sy}">${s}</g>`;
}
