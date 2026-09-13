import { HIGH_PR_COUNT } from "../parser/thresholds.js";
import type { CityLot } from "../types.js";
import { animatedFigure } from "./anim.js";
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
 * Yard props are real sprite stamps (flood-keyed sheets, occluding).
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
  let s = stamp(sheet.file, sheet, PLANNING_SHEET, anchor.sx, anchor.sy, 46, dim);
  if (lot.recentActivity) {
    if (lot.botDetected && !lot.showDrone) {
      // Bot-tended issue yard: a crane arm builds from the plans.
      // (PR yards get their crane from the drone branch below.)
      const crane = project(x - 0.15, y + 0.75);
      s += animatedFigure({
        id: `${lotTag}-crane`,
        sheet: animSheet("craneArm"),
        anchorX: crane.sx,
        anchorY: crane.sy,
        targetW: 50,
        phase: phaseFor(lot),
      });
    } else if (!lot.botDetected) {
      // A reader studies the sheet in place (idle loop, gentle bob).
      const reader = project(x - 0.15, y + 0.75);
      s += animatedFigure({
        id: `${lotTag}-read`,
        sheet: animSheet("blueprint"),
        anchorX: reader.sx,
        anchorY: reader.sy,
        targetW: 44,
        phase: phaseFor(lot),
        bob: 3,
      });
    }
  }
  return s;
}

function draftingTable(x: number, y: number, lot: CityLot, stamp: StampFn): string {
  const sheet = PROP_SHEETS.planning;
  const anchor = project(x + 0.42, y + 0.44);
  const table = PLANNING_TABLES[lot.buildingId % PLANNING_TABLES.length];
  return stamp(sheet.file, sheet, table, anchor.sx, anchor.sy, 62, !lot.recentActivity);
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
  let s = stamp(sheet.file, sheet, primary, a1.sx, a1.sy, 56, dim);
  if (lot.openPrs >= HIGH_PR_COUNT) {
    const a2 = project(x + 1.45, y + 0.35);
    const secondary = MATERIAL_LOOSE[(lot.buildingId + 3) % MATERIAL_LOOSE.length];
    s = stamp(sheet.file, sheet, secondary, a2.sx, a2.sy, 40, dim) + s;
  }
  if (lot.recentActivity) {
    // Bot-tended yards get the robot hauler; human yards the pallet-jack.
    const jack = project(x + 1.7, y + 1.0);
    s += animatedFigure({
      id: `${lotTag}-${lot.botDetected ? "rover" : "jack"}`,
      sheet: animSheet(lot.botDetected ? "platformRover" : "palletJack"),
      anchorX: jack.sx,
      anchorY: jack.sy,
      targetW: lot.botDetected ? 58 : 52,
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
    const phase = phaseFor(lot);
    const a1 = project(x + 1.5, y + 0.55);
    if (lot.botDetected) {
      // Bot patrol: a quad dog paces the yard instead of the human crew.
      return animatedFigure({
        id: `${lotTag}-dog`,
        sheet: animSheet("quadDog"),
        anchorX: a1.sx,
        anchorY: a1.sy,
        targetW: 50,
        phase,
        pace: { dx: 40, dy: 9, legs: 2 },
      });
    }
    // Live yard: a unit paces one way, a crate-carrier the other.
    const a2 = project(x + 0.75, y + 1.35);
    return (
      animatedFigure({
        id: `${lotTag}-walk`,
        sheet: animSheet("unitWalk"),
        anchorX: a1.sx,
        anchorY: a1.sy,
        targetW: 48,
        phase,
        pace: { dx: 42, dy: 10, legs: 2 },
      }) +
      animatedFigure({
        id: `${lotTag}-carry`,
        sheet: animSheet("carryCrate"),
        anchorX: a2.sx,
        anchorY: a2.sy,
        targetW: 50,
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
  const crewH = 48;
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
  const bot = lot.botDetected;
  return animatedFigure({
    id: `${lotTag}-${bot ? "dog" : "idle"}`,
    sheet: animSheet(bot ? "quadDog" : "unitWalk"),
    anchorX: anchor.sx,
    anchorY: anchor.sy,
    targetW: bot ? 50 : 48,
    phase: phaseFor(lot),
    pace: { dx: 40, dy: 9, legs: 2 },
  });
}

function drone(
  x: number,
  y: number,
  lot: CityLot,
  stamp: StampFn,
  lotTag: string,
): string {
  const anchor = project(x, y);
  const shadow =
    `<ellipse cx="${anchor.sx}" cy="${anchor.sy + 22}" rx="11" ry="4" fill="rgba(60,70,80,0.25)"/>`;
  // AI-tended yards fly the animated cargo drone (hover loop + bob); a crane
  // arm works the pad beside it.
  if (lot.botDetected || lot.recentActivity) {
    const phase = phaseFor(lot);
    let s =
      shadow +
      animatedFigure({
        id: `${lotTag}-airlift`,
        sheet: animSheet("cargoDrone"),
        anchorX: anchor.sx,
        anchorY: anchor.sy - 42,
        targetW: 54,
        phase,
        bob: 4,
      });
    if (lot.botDetected) {
      const crane = project(x - 0.5, y + 0.6);
      s += animatedFigure({
        id: `${lotTag}-crane`,
        sheet: animSheet("craneArm"),
        anchorX: crane.sx,
        anchorY: crane.sy,
        targetW: 50,
        phase,
      });
    }
    return s;
  }
  // Stale human-pressure yard: a parked dimmed quad, no motion.
  const sheet = PROP_SHEETS.drones;
  const quad = DRONE_QUADS[lot.buildingId % DRONE_QUADS.length];
  return (
    shadow +
    stamp(sheet.file, sheet, quad, anchor.sx, anchor.sy - 42, 52, true)
  );
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
    s += drone(yx + 1.25, yy - 0.2, lot, stamp, lotTag);
  }
  return `<g class="yard-props">${s}</g>`;
}

/**
 * Map-corner decor stamped from the real ground-tile kit (flood-keyed).
 * Anchors sit on the ground point; art faces the camera.
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
