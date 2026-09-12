import { HIGH_PR_COUNT } from "../parser/thresholds.js";
import type { CityLot } from "../types.js";
import { animatedFigure, bobWrap } from "./anim.js";
import { project } from "./iso.js";
import {
  animSheet,
  CREW_CARRY,
  CREW_WALK,
  DECOR_BENCH,
  DECOR_LAMP,
  DECOR_TREES,
  DRONE_QUADS,
  GROUND_SHEET,
  MATERIAL_LOOSE,
  MATERIAL_PALLETS,
  PLANNING_SHEET,
  PLANNING_TABLES,
  PROP_SHEETS,
  type SpriteBox,
  type StampFn,
} from "./sprites.js";

/**
 * Yard props are real sprite stamps (white sheets keyed out via multiply).
 * Conditions mirror the locked yard language: issues → blueprints + tables,
 * PRs → materials, recent activity → crew, bots/high PRs → drone. Only the
 * art changed from the old procedural shapes.
 */

/** Stagger loop phase per lot so a street of yards does not march in sync. */
function phaseFor(lot: CityLot): number {
  return -((lot.buildingId % 7) * 0.6);
}

function blueprint(
  x: number,
  y: number,
  lot: CityLot,
  stamp: StampFn,
  lotTag: string,
): string {
  const sheet = PROP_SHEETS.planning;
  const dim = !lot.recentActivity;
  const anchor = project(x + 0.31, y + 0.45);
  let s = stamp(sheet.file, sheet, PLANNING_SHEET, anchor.sx, anchor.sy, 70, dim);
  if (lot.recentActivity) {
    // A reader studies the sheet in place (idle loop, gentle bob).
    const reader = project(x - 0.15, y + 0.75);
    s += animatedFigure({
      id: `${lotTag}-read`,
      sheet: animSheet("blueprint"),
      anchorX: reader.sx,
      anchorY: reader.sy,
      targetW: 54,
      phase: phaseFor(lot),
      bob: 3,
    });
  }
  return s;
}

function draftingTable(x: number, y: number, lot: CityLot, stamp: StampFn): string {
  const sheet = PROP_SHEETS.planning;
  const anchor = project(x + 0.42, y + 0.44);
  const table = PLANNING_TABLES[lot.buildingId % PLANNING_TABLES.length];
  return stamp(sheet.file, sheet, table, anchor.sx, anchor.sy, 95, !lot.recentActivity);
}

function mats(
  x: number,
  y: number,
  lot: CityLot,
  stamp: StampFn,
  lotTag: string,
): string {
  const sheet = PROP_SHEETS.materials;
  const dim = !lot.recentActivity;
  const a1 = project(x + 0.9, y + 0.85);
  const primary = MATERIAL_PALLETS[lot.buildingId % MATERIAL_PALLETS.length];
  let s = stamp(sheet.file, sheet, primary, a1.sx, a1.sy, 85, dim);
  if (lot.openPrs >= HIGH_PR_COUNT) {
    const a2 = project(x + 1.45, y + 0.35);
    const secondary = MATERIAL_LOOSE[(lot.buildingId + 3) % MATERIAL_LOOSE.length];
    s = stamp(sheet.file, sheet, secondary, a2.sx, a2.sy, 60, dim) + s;
  }
  if (lot.recentActivity) {
    // A stacker works the pallet in place.
    const jack = project(x + 1.7, y + 1.0);
    s += animatedFigure({
      id: `${lotTag}-jack`,
      sheet: animSheet("palletJack"),
      anchorX: jack.sx,
      anchorY: jack.sy,
      targetW: 72,
      phase: phaseFor(lot),
      bob: 2,
    });
  }
  return s;
}

function crew(
  x: number,
  y: number,
  lot: CityLot,
  stamp: StampFn,
  lotTag: string,
): string {
  if (lot.recentActivity) {
    // Live yard: a unit paces one way, a crate-carrier the other.
    const phase = phaseFor(lot);
    const a1 = project(x + 1.5, y + 0.55);
    const a2 = project(x + 0.75, y + 1.35);
    return (
      animatedFigure({
        id: `${lotTag}-walk`,
        sheet: animSheet("unitWalk"),
        anchorX: a1.sx,
        anchorY: a1.sy,
        targetW: 56,
        phase,
        pace: { dx: 42, dy: 10, legs: 2 },
      }) +
      animatedFigure({
        id: `${lotTag}-carry`,
        sheet: animSheet("carryCrate"),
        anchorX: a2.sx,
        anchorY: a2.sy,
        targetW: 60,
        phase: phase - 1.1,
        pace: { dx: -38, dy: -8, legs: 2 },
      })
    );
  }
  const sheet = PROP_SHEETS.crew;
  const walker = CREW_WALK[lot.buildingId % CREW_WALK.length];
  const carrier = CREW_CARRY[lot.buildingId % CREW_CARRY.length];
  const a1 = project(x + 1.5, y + 0.55);
  const a2 = project(x + 0.75, y + 1.35);
  const crewH = 58;
  return (
    stamp(
      sheet.file,
      sheet,
      walker,
      a1.sx,
      a1.sy,
      walker.w * (crewH / walker.h),
      false,
    ) +
    stamp(
      sheet.file,
      sheet,
      carrier,
      a2.sx,
      a2.sy,
      carrier.w * (crewH / carrier.h),
      false,
    )
  );
}

/** A lone walker crosses yards that are active but have no other crew. */
function idleWalker(x: number, y: number, lot: CityLot, lotTag: string): string {
  const anchor = project(x + 0.7, y + 0.6);
  return animatedFigure({
    id: `${lotTag}-idle`,
    sheet: animSheet("unitWalk"),
    anchorX: anchor.sx,
    anchorY: anchor.sy,
    targetW: 56,
    phase: phaseFor(lot),
    pace: { dx: 40, dy: 9, legs: 2 },
  });
}

function drone(x: number, y: number, lot: CityLot, stamp: StampFn): string {
  const sheet = PROP_SHEETS.drones;
  const anchor = project(x, y);
  const quad = DRONE_QUADS[lot.buildingId % DRONE_QUADS.length];
  const shadow =
    `<ellipse cx="${anchor.sx}" cy="${anchor.sy + 22}" rx="14" ry="5" fill="rgba(60,70,80,0.25)"/>`;
  // Quads hover: the stamp bobs gently over its shadow.
  const hover = bobWrap(
    stamp(sheet.file, sheet, quad, anchor.sx, anchor.sy - 42, 62, false),
    4,
    3,
    phaseFor(lot),
  );
  return shadow + hover;
}

export function renderYardProps(
  originX: number,
  originY: number,
  lot: CityLot,
  stamp: StampFn,
  lotTag: string,
): string {
  const yx = originX + 2.2;
  const yy = originY + 0.2;
  let s = "";
  if (lot.showDraftingTable) {
    s += draftingTable(yx + 0.2, yy + 0.7, lot, stamp);
  }
  if (lot.showBlueprint) {
    s += blueprint(yx + 0.95, yy + 0.12, lot, stamp, lotTag);
  }
  if (lot.showMaterials) {
    s += mats(yx + 0.08, yy + 0.08, lot, stamp, lotTag);
  }
  if (lot.showCrew) {
    s += crew(yx, yy, lot, stamp, lotTag);
  }
  if (lot.yard === "idle_active") {
    s += idleWalker(yx, yy, lot, lotTag);
  }
  if (lot.showDrone) {
    s += drone(yx + 1.25, yy - 0.2, lot, stamp);
  }
  return `<g class="yard-props">${s}</g>`;
}

/**
 * Map-corner decor stamped from the real ground-tile kit (white sheet keyed
 * out via multiply). Anchors sit on the ground point; art faces the camera.
 */
function decorStamp(
  x: number,
  y: number,
  tile: SpriteBox,
  targetW: number,
  stamp: StampFn,
): string {
  const anchor = project(x, y);
  return stamp(
    GROUND_SHEET.file,
    GROUND_SHEET,
    tile,
    anchor.sx,
    anchor.sy,
    targetW,
    false,
  );
}

export function spriteTree(
  x: number,
  y: number,
  variant: number,
  stamp: StampFn,
): string {
  const tile = DECOR_TREES[variant % DECOR_TREES.length];
  return decorStamp(x, y, tile, 64, stamp);
}

export function spriteLamp(x: number, y: number, stamp: StampFn): string {
  return decorStamp(x, y, DECOR_LAMP, 26, stamp);
}

export function spriteBench(x: number, y: number, stamp: StampFn): string {
  return decorStamp(x, y, DECOR_BENCH, 84, stamp);
}
