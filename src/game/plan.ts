import { buildingSize } from "./geometry.js";
import { HIGH_PR_COUNT } from "../parser/thresholds.js";
import type { CityLot } from "../types.js";
import { project } from "../render/iso.js";
import { LOT_D, LOT_W, CONSTRUCTION_MS } from "../world/constants.js";
import type { LotPlacement } from "../world/layout.js";
function buildingAnchor(x: number, y: number) {
  return { x: x + 1, y: y + LOT_D / 2 };
}
function yardOrigin(x: number, y: number) {
  return { x: x + 2.1, y: y + 0.1 };
}

import {
  ANIM_SHEETS,
  BUILDING_SHEETS,
  CREW_CARRY,
  CREW_WALK,
  DRONE_QUADS,
  GROUND_SHEET,
  LOT_TILE_DIRT,
  LOT_TILE_GRASS,
  MATERIAL_LOOSE,
  MATERIAL_PALLETS,
  PLANNING_SHEET,
  PLANNING_TABLES,
  PROP_SHEETS,
  sheetForBand,
  spriteBoxFor,
  WILD_SHEETS,
  type AnimSheet,
  type SpriteBox,
} from "../render/sprites.js";

export type StampLayer = "ground" | "decor" | "world";

export interface DiamondOp {
  kind: "diamond";
  x: number;
  y: number;
  w: number;
  d: number;
  fill: number;
  fillAlpha: number;
  stroke: number;
  strokeAlpha: number;
  depth: number;
}

export interface ImageStamp {
  kind: "image";
  sheet: string;
  box: SpriteBox;
  sx: number;
  sy: number;
  scaleX: number;
  scaleY: number;
  dimmed: boolean;
  depth: number;
  layer: StampLayer;
  tag?: string;
  repo?: string;
  pixelated?: boolean;
  alpha?: number;
}

export interface AnimStamp {
  kind: "anim";
  anim: string;
  sheet: AnimSheet;
  sx: number;
  sy: number;
  targetW: number;
  depth: number;
  phase: number;
  pace?: { dx: number; dy: number; legs: number };
  bob?: number;
  repo?: string;
}

export interface EllipseOp {
  kind: "ellipse";
  sx: number;
  sy: number;
  rx: number;
  ry: number;
  fill: number;
  fillAlpha: number;
  depth: number;
}

export interface HitOp {
  kind: "hit";
  repo: string;
  x: number;
  y: number;
  w: number;
  d: number;
}

export type SceneOp = DiamondOp | ImageStamp | AnimStamp | EllipseOp | HitOp;

export interface LotRenderPlan {
  diamonds: DiamondOp[];
  ellipses: EllipseOp[];
  images: ImageStamp[];
  anims: AnimStamp[];
  hits: HitOp[];
}
function depthAt(wx: number, wy: number, bias = 0): number {
  return (wx + wy) * 18 + bias;
}

function hex(rgb: string): number {
  return Number.parseInt(rgb.replace("#", ""), 16);
}

function phaseFor(lot: CityLot): number {
  return -((lot.buildingId % 7) * 0.6);
}

function imageStamp(
  sheet: { file: string; width: number; height: number },
  box: SpriteBox,
  sx: number,
  sy: number,
  targetW: number,
  dimmed: boolean,
  depth: number,
  layer: StampLayer,
  extra?: Partial<ImageStamp>,
): ImageStamp {
  const s = targetW / box.w;
  return {
    kind: "image",
    sheet: sheet.file,
    box,
    sx,
    sy,
    scaleX: s,
    scaleY: s,
    dimmed,
    depth,
    layer,
    ...extra,
  };
}

function lotTileOps(
  place: LotPlacement,
  index: number,
  diamonds: DiamondOp[],
  images: ImageStamp[],
): void {
  const { lot, x, y } = place;
  const worked = lot.yard === "fully_dormant" || lot.yard.startsWith("prs_");
  const tile: SpriteBox = worked
    ? LOT_TILE_DIRT
    : LOT_TILE_GRASS[index % LOT_TILE_GRASS.length];
  const bed = worked ? "c9a06b" : "8fc46a";
  diamonds.push({
    kind: "diamond",
    x: x + 0.15,
    y: y + 0.15,
    w: LOT_W - 0.3,
    d: LOT_D - 0.3,
    fill: hex(bed),
    fillAlpha: 1,
    stroke: hex("283c23"),
    strokeAlpha: 0.18,
    depth: -100_000,
  });
  const bc = {
    sx: project(x + LOT_W / 2, y + LOT_D / 2).sx,
    sy: project(x + LOT_W, y + LOT_D).sy,
  };
  const stamp = imageStamp(
    GROUND_SHEET,
    tile,
    bc.sx,
    bc.sy,
    tile.w,
    false,
    -99_999,
    "ground",
  );
  stamp.scaleX = ((LOT_W + LOT_D) * 36) / tile.w;
  stamp.scaleY = ((LOT_W + LOT_D) * 18) / tile.h;
  images.push(stamp);
}

function blueprintOps(
  x: number,
  y: number,
  lot: CityLot,
  images: ImageStamp[],
  anims: AnimStamp[],
  depth: number,
): void {
  const sheet = PROP_SHEETS.planning;
  const dim = !lot.recentActivity;
  const anchor = project(x + 0.31, y + 0.45);
  images.push(
    imageStamp(
      sheet,
      PLANNING_SHEET,
      anchor.sx,
      anchor.sy,
      46,
      dim,
      depth,
      "world",
      { repo: lot.fullName },
    ),
  );
  if (!lot.recentActivity) return;
  const reader = project(x - 0.15, y + 0.75);
  if (lot.botDetected && !lot.showDrone) {
    anims.push({
      kind: "anim",
      anim: "craneArm",
      sheet: ANIM_SHEETS.craneArm,
      sx: reader.sx,
      sy: reader.sy,
      targetW: 50,
      depth: depth + 1,
      phase: phaseFor(lot),
      repo: lot.fullName,
    });
  } else if (!lot.botDetected) {
    anims.push({
      kind: "anim",
      anim: "blueprint",
      sheet: ANIM_SHEETS.blueprint,
      sx: reader.sx,
      sy: reader.sy,
      targetW: 44,
      depth: depth + 1,
      phase: phaseFor(lot),
      bob: 3,
      repo: lot.fullName,
    });
  }
}

function draftingTableOp(
  x: number,
  y: number,
  lot: CityLot,
  images: ImageStamp[],
  depth: number,
): void {
  const sheet = PROP_SHEETS.planning;
  const anchor = project(x + 0.42, y + 0.44);
  const table = PLANNING_TABLES[lot.buildingId % PLANNING_TABLES.length];
  images.push(
    imageStamp(
      sheet,
      table,
      anchor.sx,
      anchor.sy,
      62,
      !lot.recentActivity,
      depth,
      "world",
      {
        repo: lot.fullName,
      },
    ),
  );
}

function matsOps(
  x: number,
  y: number,
  lot: CityLot,
  images: ImageStamp[],
  anims: AnimStamp[],
  depth: number,
): void {
  const sheet = PROP_SHEETS.materials;
  const dim = !lot.recentActivity;
  const a1 = project(x + 0.9, y + 0.85);
  const primary = MATERIAL_PALLETS[lot.buildingId % MATERIAL_PALLETS.length];
  if (lot.openPrs >= HIGH_PR_COUNT) {
    const a2 = project(x + 1.45, y + 0.35);
    const secondary =
      MATERIAL_LOOSE[(lot.buildingId + 3) % MATERIAL_LOOSE.length];
    images.push(
      imageStamp(sheet, secondary, a2.sx, a2.sy, 40, dim, depth, "world", {
        repo: lot.fullName,
      }),
    );
  }
  images.push(
    imageStamp(sheet, primary, a1.sx, a1.sy, 56, dim, depth + 0.2, "world", {
      repo: lot.fullName,
    }),
  );
  if (lot.recentActivity) {
    const jack = project(x + 1.7, y + 1.0);
    const bot = lot.botDetected;
    anims.push({
      kind: "anim",
      anim: bot ? "platformRover" : "palletJack",
      sheet: bot ? ANIM_SHEETS.platformRover : ANIM_SHEETS.palletJack,
      sx: jack.sx,
      sy: jack.sy,
      targetW: bot ? 58 : 52,
      depth: depth + 1,
      phase: phaseFor(lot),
      bob: 2,
      repo: lot.fullName,
    });
  }
}

function crewOps(
  x: number,
  y: number,
  lot: CityLot,
  images: ImageStamp[],
  anims: AnimStamp[],
  depth: number,
): void {
  if (lot.recentActivity) {
    const phase = phaseFor(lot);
    const a1 = project(x + 1.5, y + 0.55);
    if (lot.botDetected) {
      anims.push({
        kind: "anim",
        anim: "quadDog",
        sheet: ANIM_SHEETS.quadDog,
        sx: a1.sx,
        sy: a1.sy,
        targetW: 50,
        depth: depth + 1,
        phase,
        pace: { dx: 40, dy: 9, legs: 2 },
        repo: lot.fullName,
      });
      return;
    }
    const a2 = project(x + 0.75, y + 1.35);
    anims.push({
      kind: "anim",
      anim: "unitWalk",
      sheet: ANIM_SHEETS.unitWalk,
      sx: a1.sx,
      sy: a1.sy,
      targetW: 48,
      depth: depth + 1,
      phase,
      pace: { dx: 42, dy: 10, legs: 2 },
      repo: lot.fullName,
    });
    anims.push({
      kind: "anim",
      anim: "carryCrate",
      sheet: ANIM_SHEETS.carryCrate,
      sx: a2.sx,
      sy: a2.sy,
      targetW: 50,
      depth: depth + 1,
      phase: phase - 1.1,
      pace: { dx: -38, dy: -8, legs: 2 },
      repo: lot.fullName,
    });
    return;
  }
  const sheet = PROP_SHEETS.crew;
  const walker = CREW_WALK[lot.buildingId % CREW_WALK.length];
  const carrier = CREW_CARRY[lot.buildingId % CREW_CARRY.length];
  const a1 = project(x + 1.5, y + 0.55);
  const a2 = project(x + 0.75, y + 1.35);
  const crewH = 48;
  images.push(
    imageStamp(
      sheet,
      walker,
      a1.sx,
      a1.sy,
      walker.w * (crewH / walker.h),
      false,
      depth,
      "world",
      {
        repo: lot.fullName,
      },
    ),
  );
  images.push(
    imageStamp(
      sheet,
      carrier,
      a2.sx,
      a2.sy,
      carrier.w * (crewH / carrier.h),
      false,
      depth,
      "world",
      {
        repo: lot.fullName,
      },
    ),
  );
}

function idleWalkerOp(
  x: number,
  y: number,
  lot: CityLot,
  anims: AnimStamp[],
  depth: number,
): void {
  const anchor = project(x + 0.7, y + 0.6);
  const bot = lot.botDetected;
  anims.push({
    kind: "anim",
    anim: bot ? "quadDog" : "unitWalk",
    sheet: bot ? ANIM_SHEETS.quadDog : ANIM_SHEETS.unitWalk,
    sx: anchor.sx,
    sy: anchor.sy,
    targetW: bot ? 50 : 48,
    depth: depth + 1,
    phase: phaseFor(lot),
    pace: { dx: 40, dy: 9, legs: 2 },
    repo: lot.fullName,
  });
}

function droneOps(
  x: number,
  y: number,
  lot: CityLot,
  images: ImageStamp[],
  anims: AnimStamp[],
  ellipses: EllipseOp[],
  depth: number,
): void {
  const anchor = project(x, y);
  ellipses.push({
    kind: "ellipse",
    sx: anchor.sx,
    sy: anchor.sy + 22,
    rx: 11,
    ry: 4,
    fill: hex("3c4650"),
    fillAlpha: 0.25,
    depth: depth - 0.5,
  });
  if (lot.botDetected || lot.recentActivity) {
    const phase = phaseFor(lot);
    anims.push({
      kind: "anim",
      anim: "cargoDrone",
      sheet: ANIM_SHEETS.cargoDrone,
      sx: anchor.sx,
      sy: anchor.sy - 42,
      targetW: 54,
      depth: depth + 8,
      phase,
      bob: 4,
      repo: lot.fullName,
    });
    if (lot.botDetected) {
      const crane = project(x - 0.5, y + 0.6);
      anims.push({
        kind: "anim",
        anim: "craneArm",
        sheet: ANIM_SHEETS.craneArm,
        sx: crane.sx,
        sy: crane.sy,
        targetW: 50,
        depth: depth + 2,
        phase,
        repo: lot.fullName,
      });
    }
    return;
  }
  const sheet = PROP_SHEETS.drones;
  const quad = DRONE_QUADS[lot.buildingId % DRONE_QUADS.length];
  images.push(
    imageStamp(
      sheet,
      quad,
      anchor.sx,
      anchor.sy - 42,
      52,
      true,
      depth + 8,
      "world",
      {
        repo: lot.fullName,
      },
    ),
  );
}

function yardOps(
  place: LotPlacement,
  images: ImageStamp[],
  anims: AnimStamp[],
  ellipses: EllipseOp[],
): void {
  const { lot } = place;
  const origin = yardOrigin(place.x, place.y);
  const yx = origin.x;
  const yy = origin.y;
  const depth = depthAt(place.x, place.y, 4);
  if (lot.showDraftingTable)
    draftingTableOp(yx + 0.2, yy + 0.7, lot, images, depth);
  if (lot.showBlueprint)
    blueprintOps(yx + 0.95, yy + 0.12, lot, images, anims, depth);
  if (lot.showMaterials)
    matsOps(yx + 0.08, yy + 0.08, lot, images, anims, depth);
  if (lot.showCrew) crewOps(yx, yy, lot, images, anims, depth);
  if (lot.yard === "idle_active") idleWalkerOp(yx, yy, lot, anims, depth);
  if (lot.showDrone)
    droneOps(yx + 1.25, yy - 0.2, lot, images, anims, ellipses, depth);
}

function buildingOp(place: LotPlacement, images: ImageStamp[]): void {
  const { lot } = place;
  const sheet = sheetForBand(
    lot.buildingId <= 17 ? "S" : lot.buildingId <= 34 ? "M" : "L",
  );
  const box = spriteBoxFor(lot.buildingId);
  const plant = buildingAnchor(place.x, place.y);
  const anchor = project(plant.x, plant.y);
  images.push(
    imageStamp(
      sheet,
      box,
      anchor.sx,
      anchor.sy,
      buildingSize(lot).width,
      !lot.recentActivity,
      depthAt(place.x, place.y, 6),
      "world",
      { repo: lot.fullName, tag: "building" },
    ),
  );
}

/** Every sheet the Phaser preloader must fetch. */
export function requiredSheets(): string[] {
  const files = new Set<string>([
    BUILDING_SHEETS.S.file,
    BUILDING_SHEETS.M.file,
    BUILDING_SHEETS.L.file,
    GROUND_SHEET.file,
    PROP_SHEETS.materials.file,
    PROP_SHEETS.planning.file,
    PROP_SHEETS.crew.file,
    PROP_SHEETS.drones.file,
    WILD_SHEETS.trees.file,
    WILD_SHEETS.bushes.file,
  ]);
  for (const sheet of Object.values(ANIM_SHEETS)) files.add(sheet.file);
  return [...files];
}

/** Materialize a visible lot only. The canonical world plan owns every address. */
export function planLot(
  place: LotPlacement,
  detail = true,
  now = Date.now(),
): LotRenderPlan {
  const result: LotRenderPlan = {
    diamonds: [],
    ellipses: [],
    images: [],
    anims: [],
    hits: [],
  };
  lotTileOps(place, place.lot.buildingId, result.diamonds, result.images);
  buildingOp(place, result.images);
  if (detail) yardOps(place, result.images, result.anims, result.ellipses);
  result.hits.push({
    kind: "hit",
    repo: place.lot.fullName,
    x: place.x,
    y: place.y,
    w: LOT_W,
    d: LOT_D,
  });
  const building = result.images.find((image) => image.tag === "building");
  if (building)
    building.alpha = place.lot.recentActivity
      ? 1
      : (place.lot.quietAlpha ?? 0.62);
  if (place.addedAt && now - Date.parse(place.addedAt) < CONSTRUCTION_MS) {
    if (building) building.alpha = 0.25;
    const anchor = project(place.x + 0.4, place.y + 1.1);
    result.anims.push({
      kind: "anim",
      anim: "craneArm",
      sheet: ANIM_SHEETS.craneArm,
      sx: anchor.sx,
      sy: anchor.sy,
      targetW: 64,
      depth: anchor.sy + 15,
      phase: 0,
      repo: place.lot.fullName,
    });
  }
  // Human crews use a small walking person; the robot atlas remains for bot yards.
  result.anims = result.anims.filter(
    (op) =>
      op.anim === "cargoDrone" ||
      op.anim === "craneArm" ||
      place.lot.showCrew ||
      place.lot.yard === "idle_active",
  );
  if (place.lot.occupantClass === "human")
    for (const op of result.anims) {
      if (
        ["unitWalk", "carryCrate", "blueprint", "palletJack"].includes(op.anim)
      ) {
        op.anim = "humanWalk";
        op.targetW = 18;
      }
    }
  for (const image of result.images)
    if (image.layer === "world") image.depth = image.sy;
  for (const anim of result.anims)
    anim.depth = anim.sy + (anim.anim === "cargoDrone" ? 1000 : 0);
  return result;
}
