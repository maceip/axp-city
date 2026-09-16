import type { CityLot } from "../types.js";
import { TILE_H, TILE_W } from "./iso.js";
import { WILD_BUSHES, WILD_TREES } from "./sprites.js";

/**
 * Shared isometric lot grid. SVG and Phaser stamp the same world: each
 * GitHub repo occupies one dual-plot lot (building pad + receiving yard)
 * with streets between rows.
 */

export const COLS = 4;
export const LOT_W = 4;
export const LOT_D = 2.4;
/** Streets are real tile stamps ~1 world unit wide. */
export const ROAD_D = 1.0;
export const SHOULDER = 0.35;
export const STRIDE_X = 4.7;
export const STRIDE_Y = LOT_D + ROAD_D + SHOULDER * 2;
export const MARGIN = 1.4;
export const ROAD_TOP0 = MARGIN - SHOULDER - ROAD_D;

export const FOREST_PAD_X = 6;
export const FOREST_PAD_Y = 4;
export const FOREST_STEP = 1.7;
/** Tallest stamps rise ~260px above their anchors; keep them inside. */
export const VB_Y = -240;

/** Measured boxes 0-1 are sheet UI thumbnails, not trees. */
export const FOREST_TREES = WILD_TREES.filter((box) => box.h >= 50);
/** The full-width bush row is a hedge strip rather than a plantable bush. */
export const FOREST_BUSHES = WILD_BUSHES.filter((box) => box.w <= 64);

export interface LotPlacement {
  lot: CityLot;
  col: number;
  row: number;
  x: number;
  y: number;
}

export interface WorldSize {
  w: number;
  h: number;
  rows: number;
}

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

export function roadCenterY(row: number): number {
  return ROAD_TOP0 + row * STRIDE_Y + ROAD_D / 2;
}

/** Deterministic 0-1 hash for stable foliage variety (no RNG in renders). */
export function hash01(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed, 974634211);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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

export function worldSize(count: number): WorldSize {
  const rows = Math.max(1, Math.ceil(count / COLS));
  return {
    rows,
    w: MARGIN + COLS * STRIDE_X + 0.8,
    h: MARGIN + rows * STRIDE_Y + 0.6,
  };
}

export function worldBounds(w: number, h: number): WorldBounds {
  const x0 = -FOREST_PAD_X;
  const y0 = -FOREST_PAD_Y;
  const x1 = w + FOREST_PAD_X;
  const y1 = h + FOREST_PAD_Y;
  const sx0 = (x0 - y1) * (TILE_W / 2);
  const sx1 = (x1 - y0) * (TILE_W / 2);
  const sy1 = (x1 + y1) * (TILE_H / 2) + 80;
  return { x: sx0, y: VB_Y, width: sx1 - sx0, height: sy1 - VB_Y };
}

/** Building pad plant point: bottom-center of the first diamond half. */
export function buildingAnchor(originX: number, originY: number): { x: number; y: number } {
  return { x: originX + 1, y: originY + LOT_D / 2 };
}

/** Receiving-yard origin (loading zone) on the dual-plot's right half. */
export function yardOrigin(originX: number, originY: number): { x: number; y: number } {
  return { x: originX + 2.2, y: originY + 0.2 };
}
