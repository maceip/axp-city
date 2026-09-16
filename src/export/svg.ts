import { planLot, type ImageStamp, type AnimStamp } from "../game/plan.js";
import type { CitySnapshot } from "../live/protocol.js";
import { project, TILE_H, TILE_W } from "../render/iso.js";
import { ANIM_SHEETS, GROUND_SHEET, PROP_SHEETS, BUILDING_SHEETS, WILD_SHEETS, CIVIC_SHEET, HUD_SHEET } from "../render/sprites.js";
import { LOT_D, LOT_W, STRIDE_X, STRIDE_Y } from "../world/constants.js";
import type { CityPlan, CityFeature, VacantPlot } from "../world/layout.js";

export interface SvgExportOptions {
  /** URL prefix for sprite sheets (`/assets/sprites/` on the server, `./sprites/` offline). */
  assetBase?: string;
  /** Include yard props, crews, and drones (first animation frame). */
  detail?: boolean;
  /** Frame used for animated stamps; exports are stills. */
  now?: number;
  /** Pixels of margin around the developed bounds. */
  margin?: number;
  title?: string;
}

const FEATURE_FILL: Record<CityFeature["kind"], string> = {
  park: "#6f8f54",
  freeway: "#4a4f57",
  tram: "#8a8f96",
  plaza: "#c9b7a0",
  river: "#5a8a8e",
  office: "#c9b56a",
  bike: "#767056",
};

const VACANT_FILL: Record<VacantPlot["variant"], string> = {
  grass: "#8aa86a",
  dirt: "#c9a06b",
  trees: "#5b8f47",
  plaza: "#d3c4ad",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function diamond(x: number, y: number, w: number, d: number): string {
  const a = project(x, y);
  const b = project(x + w, y);
  const c = project(x + w, y + d);
  const e = project(x, y + d);
  return [a, b, c, e].map((p) => `${num(p.sx)},${num(p.sy)}`).join(" ");
}

function sheetSize(file: string): { width: number; height: number } {
  const all = [
    ...Object.values(BUILDING_SHEETS),
    GROUND_SHEET,
    ...Object.values(PROP_SHEETS),
    ...Object.values(ANIM_SHEETS),
    ...Object.values(WILD_SHEETS),
    CIVIC_SHEET,
    HUD_SHEET,
  ];
  const match = all.find((sheet) => sheet.file === file);
  if (!match) throw new Error(`Unknown sprite sheet ${file}`);
  return { width: match.width, height: match.height };
}

/** A cropped sprite: nested <svg> with a viewBox selecting the source box. */
function cropped(
  href: string,
  sheet: { width: number; height: number },
  box: { x: number; y: number; w: number; h: number },
  sx: number,
  sy: number,
  scaleX: number,
  scaleY: number,
  alpha: number,
  title?: string,
): string {
  const w = box.w * scaleX;
  const h = box.h * scaleY;
  // Stamps are anchored at bottom-centre, matching the Phaser origin (0.5, 1).
  const x = sx - w / 2;
  const y = sy - h;
  return (
    `<svg x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="none"${alpha < 1 ? ` opacity="${num(alpha)}"` : ""}>` +
    (title ? `<title>${esc(title)}</title>` : "") +
    `<image href="${esc(href)}" width="${sheet.width}" height="${sheet.height}" image-rendering="optimizeQuality"/></svg>`
  );
}

function imageOp(op: ImageStamp, assetBase: string): string {
  if (op.url)
    return cropped(
      op.url,
      { width: op.box.w, height: op.box.h },
      op.box,
      op.sx,
      op.sy,
      op.scaleX,
      op.scaleY,
      (op.alpha ?? 1) * (op.dimmed ? 0.7 : 1),
      op.repo,
    );
  return cropped(
    `${assetBase}${op.sheet}`,
    sheetSize(op.sheet),
    op.box,
    op.sx,
    op.sy,
    op.scaleX,
    op.scaleY,
    (op.alpha ?? 1) * (op.dimmed ? 0.7 : 1),
    op.repo && op.tag === "building" ? op.repo : undefined,
  );
}

/** People and vehicles are generated in the client; the export draws a vector stand-in. */
function figureOp(op: AnimStamp): string {
  const hat = op.behaviour === "work" ? "#f0c14a" : "#d9e4ee";
  const vest = op.behaviour === "carry" ? "#e85d04" : op.behaviour === "wave" ? "#2a9d8f" : "#3d5a80";
  const arm =
    op.behaviour === "wave"
      ? `<rect x="4.2" y="-18" width="2.2" height="7" rx="1" fill="#e2b089" transform="rotate(-35 5 -14)"/>`
      : `<rect x="-6.2" y="-15" width="2.2" height="7" rx="1" fill="#e2b089"/><rect x="4" y="-15" width="2.2" height="7" rx="1" fill="#e2b089"/>`;
  const crate = op.behaviour === "carry" ? `<rect x="-4" y="-19" width="8" height="5" fill="#b8894c"/>` : "";
  return (
    `<g class="person" data-behaviour="${op.behaviour}" transform="translate(${num(op.sx)} ${num(op.sy)}) scale(${num(op.targetW / 18)})">` +
    `<ellipse cx="0" cy="1" rx="6" ry="2.2" fill="rgba(40,40,40,0.28)"/>` +
    `<rect x="-3.2" y="-7" width="3.1" height="7" rx="0.6" fill="#3a3f4b"/><rect x="0.4" y="-7" width="3.1" height="7" rx="0.6" fill="#3a3f4b"/>` +
    `<rect x="-4.2" y="-16" width="8.4" height="10" rx="1.4" fill="${vest}"/>` +
    `<circle cx="0" cy="-20" r="4.1" fill="#e2b089"/>` +
    `<rect x="-5.6" y="-24.4" width="11.2" height="3" fill="${hat}"/>` +
    arm +
    crate +
    `</g>`
  );
}

function animOp(op: AnimStamp, assetBase: string, now: number): string {
  if (op.anim.startsWith("human")) return figureOp(op);
  const sheet = op.sheet;
  const cellW = sheet.width / sheet.cols;
  const cellH = sheet.height / sheet.rows;
  const frame =
    Math.floor(((now / 1000) * sheet.fps + Math.abs(op.phase) * sheet.fps) % sheet.frames);
  const box = {
    x: (frame % sheet.cols) * cellW,
    y: Math.floor(frame / sheet.cols) * cellH,
    w: cellW,
    h: cellH,
  };
  const scale = op.targetW / cellW;
  return cropped(`${assetBase}${sheet.file}`, sheet, box, op.sx, op.sy, scale, scale, 1);
}

/** World-space bounds of the developed plan projected to screen space. */
export function svgViewBox(plan: CityPlan, margin: number) {
  const { minX, minY, maxX, maxY } = plan.bounds;
  const corners = [
    project(minX, minY),
    project(maxX, minY),
    project(maxX, maxY),
    project(minX, maxY),
  ];
  const left = Math.min(...corners.map((c) => c.sx)) - margin;
  const right = Math.max(...corners.map((c) => c.sx)) + margin;
  // Tall buildings and drones rise above their pads.
  const top = Math.min(...corners.map((c) => c.sy)) - margin - 240;
  const bottom = Math.max(...corners.map((c) => c.sy)) + margin;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Render the shared plan as a standalone SVG document. Buildings and props
 * come from the same `planLot` operations the Phaser scene draws, so the
 * export shows the same city; animated actors are captured on one frame.
 * This module is export-only and is not a second city renderer.
 */
export function renderCitySvg(
  snapshot: Pick<CitySnapshot, "plan" | "serverTime" | "revision"> & Partial<CitySnapshot>,
  options: SvgExportOptions = {},
): string {
  const plan = snapshot.plan;
  const assetBase = options.assetBase ?? "/assets/sprites/";
  const detail = options.detail ?? true;
  const now = options.now ?? Date.parse(snapshot.serverTime);
  const margin = options.margin ?? 80;
  const view = svgViewBox(plan, margin);
  const parts: string[] = [];

  const ground: string[] = [];
  const { minSx, maxSx, minSy, maxSy } = plan.slotBounds;
  ground.push(
    `<polygon points="${diamond(
      minSx * STRIDE_X - 1,
      minSy * STRIDE_Y - 1,
      (maxSx - minSx + 1) * STRIDE_X + 2,
      (maxSy - minSy + 1) * STRIDE_Y + LOT_D + 2,
    )}" fill="#6f7d70"/>`,
  );
  for (const feature of plan.features)
    ground.push(
      `<polygon points="${diamond(feature.x, feature.y, feature.w, feature.h)}" fill="${FEATURE_FILL[feature.kind]}"><title>${esc(feature.id)}</title></polygon>`,
    );
  for (const vacancy of plan.vacancies)
    ground.push(
      `<polygon points="${diamond(vacancy.x + 0.15, vacancy.y + 0.15, LOT_W - 0.3, LOT_D - 0.3)}" fill="${VACANT_FILL[vacancy.variant]}" stroke="#283c23" stroke-opacity="0.18"/>`,
    );
  parts.push(`<g id="ground">${ground.join("")}</g>`);

  const world: Array<{ depth: number; svg: string }> = [];
  const sorted = [...plan.placements].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const place of sorted) {
    const lotPlan = planLot(place, detail, now);
    const lotParts: string[] = [];
    for (const d of lotPlan.diamonds)
      lotParts.push(
        `<polygon points="${diamond(d.x, d.y, d.w, d.d)}" fill="#${d.fill.toString(16).padStart(6, "0")}" fill-opacity="${num(d.fillAlpha)}" stroke="#${d.stroke.toString(16).padStart(6, "0")}" stroke-opacity="${num(d.strokeAlpha)}"/>`,
      );
    for (const e of lotPlan.ellipses)
      lotParts.push(
        `<ellipse cx="${num(e.sx)}" cy="${num(e.sy)}" rx="${num(e.rx)}" ry="${num(e.ry)}" fill="#${e.fill.toString(16).padStart(6, "0")}" fill-opacity="${num(e.fillAlpha)}"/>`,
      );
    const stamps: Array<{ depth: number; svg: string }> = [];
    for (const image of lotPlan.images)
      stamps.push({
        depth: image.layer === "ground" ? -1e9 : image.depth,
        svg: imageOp(image, assetBase),
      });
    if (detail)
      for (const anim of lotPlan.anims)
        stamps.push({ depth: anim.depth, svg: animOp(anim, assetBase, now) });
    stamps.sort((a, b) => a.depth - b.depth);
    const label = `${place.lot.fullName} — ${place.district}, slot ${place.col},${place.row}`;
    world.push({
      depth: place.x + place.y,
      svg:
        `<g class="lot" data-repo="${esc(place.lot.fullName)}" data-band="${place.lot.buildingBand}" data-yard="${esc(place.lot.yard)}" data-crew="${esc(place.lot.occupantClass)}"${place.constructing ? ' data-constructing="true"' : ""}>` +
        `<title>${esc(label)}</title>` +
        lotParts.join("") +
        stamps.map((s) => s.svg).join("") +
        `</g>`,
    });
  }
  world.sort((a, b) => a.depth - b.depth);
  parts.push(`<g id="lots">${world.map((w) => w.svg).join("")}</g>`);

  const title = options.title ?? `AXP City — revision ${snapshot.revision}`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(view.x)} ${num(view.y)} ${num(view.width)} ${num(view.height)}" width="${num(view.width)}" height="${num(view.height)}" data-revision="${snapshot.revision}" data-server-time="${esc(snapshot.serverTime)}" data-lots="${plan.placements.length}" data-tile="${TILE_W}x${TILE_H}">` +
    `<title>${esc(title)}</title>` +
    `<desc>Exported from the shared AXP City plan. ${plan.placements.length} lots, ${plan.features.length} features.</desc>` +
    `<rect x="${num(view.x)}" y="${num(view.y)}" width="${num(view.width)}" height="${num(view.height)}" fill="#7fa86a"/>` +
    parts.join("") +
    `</svg>\n`
  );
}
