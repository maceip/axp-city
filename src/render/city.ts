import type { CityLot } from "../types.js";
import { diamond, fmt, project, TILE_H, TILE_W } from "./iso.js";
import {
  renderYardProps,
  spriteBench,
  spriteLamp,
  spriteTree,
} from "./props.js";
import {
  sheetForBand,
  spriteBoxFor,
  stamper,
  type StampFn,
} from "./sprites.js";

/** Real sprite art from assets/city-sprites (flood-keyed, occluding stamps). */
function buildingStamp(lot: CityLot, x: number, y: number, stamp: StampFn): string {
  const sheet = sheetForBand(lot.buildingBand);
  const box = spriteBoxFor(lot.buildingId);
  return stamp(
    sheet.file,
    sheet,
    box,
    (x - y - 0.2) * 36,
    (x + y + 2.2) * 18,
    230.4,
    !lot.recentActivity,
  );
}

const COLS = 4;
const LOT_W = 4;
const LOT_D = 2.4;
const STRIDE_X = 4.7;
const STRIDE_Y = 3.35;
const MARGIN = 1.4;

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

function groundLayer(placements: LotPlacement[]): string {
  const { w, h } = worldSize(placements.length);
  let s = "";
  s += diamond(0, 0, w, h, "#7fbe56", "rgba(40,70,30,0.16)");
  s += diamond(0.35, 0.35, w - 0.7, h - 0.7, "#86c55c", "rgba(40,70,30,0.08)");

  const rows = Math.max(1, Math.ceil(placements.length / COLS));
  for (let r = 0; r <= rows; r++) {
    const y = MARGIN - 0.55 + r * STRIDE_Y;
    s += diamond(0.6, y, w - 1.2, 0.55, "#4b525c", "rgba(20,24,28,0.25)");
  }
  for (let c = 0; c <= COLS; c++) {
    const x = MARGIN - 0.5 + c * STRIDE_X;
    s += diamond(x, 0.5, 0.55, h - 1.0, "#4b525c", "rgba(20,24,28,0.25)");
  }

  s += diamond(w - 2.2, h - 2.0, 2.0, 1.7, "#4ea2d6", "rgba(20,70,110,0.2)");

  for (const place of placements) {
    s += diamond(place.x, place.y, 2, LOT_D, "#e7ebf0", "rgba(50,60,70,0.2)");
    s += diamond(place.x + 2, place.y, 2, LOT_D, "#d2a15c", "rgba(80,50,20,0.2)");
  }
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

function label(place: LotPlacement): string {
  const { lot, x, y } = place;
  const anchor = project(x + 2.05, y + LOT_D + 0.05);
  const title = `${lot.owner}/${lot.name}`;
  const sub = `${lot.buildingBand}${String(lot.buildingId).padStart(2, "0")} · ${lot.yard.replaceAll("_", " ")}`;
  const width = Math.max(172, title.length * 7.1 + 18);
  return `
    <g class="lot-label" transform="translate(${fmt(anchor.sx - width / 2)}, ${fmt(anchor.sy + 6)})">
      <rect x="0" y="0" width="${width}" height="34" rx="8" fill="rgba(255,255,255,0.95)" stroke="rgba(40,50,60,0.14)"/>
      <text x="${width / 2}" y="14" text-anchor="middle" font-size="11" font-weight="650" fill="#1f2933">${escapeXml(title)}</text>
      <text x="${width / 2}" y="27" text-anchor="middle" font-size="10" fill="#5b6773">${escapeXml(sub)}</text>
    </g>`;
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

export function renderCitySvg(lots: CityLot[], generatedAt: string): string {
  const placements = placeLots(lots);
  const { w, h } = worldSize(lots.length);
  const min = project(0, h);
  const max = project(w, 0);
  const bottom = project(w, h);
  const pad = 70;
  const vbX = min.sx - pad;
  const vbY = -24;
  const vbW = max.sx - min.sx + pad * 2;
  const vbH = bottom.sy + 70;
  const sorted = [...placements].sort((a, b) => a.x + a.y - (b.x + b.y));

  // Decor stamps share one stamper id past the per-lot range (0..n-1).
  const decorStamp = stamper(placements.length);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg id="axp-map" xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" role="img" aria-label="AXP City isometric map generated ${generatedAt}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f4f1ea"/>
      <stop offset="100%" stop-color="#e8eef1"/>
    </linearGradient>
  </defs>
  <rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="url(#sky)"/>
  <g font-family="ui-sans-serif, system-ui, sans-serif">
    ${groundLayer(placements)}
    ${decorLayer(placements, decorStamp)}
    ${sorted.map((place, i) => lotGroup(place, i)).join("\n")}
    <g class="labels">
    ${sorted.map(label).join("\n")}
    </g>
    <g class="hits">
    ${sorted.map(hitTile).join("\n")}
    </g>
  </g>
</svg>`;
}

export function cityBounds(): { tileW: number; tileH: number } {
  return { tileW: TILE_W, tileH: TILE_H };
}
