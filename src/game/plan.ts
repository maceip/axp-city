import { buildingSize } from "./geometry.js";
import { constructionState, type ConstructionState } from "./construction.js";
import { HIGH_PR_COUNT } from "../parser/thresholds.js";
import type { DecorPropName, YardSlot } from "../rules/cityFiles.js";
import type { CityLot } from "../types.js";
import { project } from "../render/iso.js";
import { LOT_D, LOT_W } from "../world/constants.js";
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
  CIVIC_PLANTS,
  CIVIC_SHEET,
  CIVIC_SPRITES,
  CONSTRUCTION_STAGES,
  CREW_CARRY,
  CREW_WALK,
  DRONE_QUADS,
  GROUND_SHEET,
  GROUND_TILES,
  HUD_SHEET,
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
  /** Multiply tint (0xffffff = none). Parser `facadeTint` for repo buildings. */
  tint?: number;
  /** Same-origin URL for artwork that is not part of the bundled sprite kit. */
  url?: string;
}

/** Distinct behaviours the client animates. */
export type ActorBehaviour = "walk" | "work" | "carry" | "wave" | "fly" | "drive";

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
  /** Stable per-lot actor identity so leaving and returning keeps its state. */
  actorId: string;
  behaviour: ActorBehaviour;
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
  /** Present while the lot is still under construction. */
  construction?: ConstructionState;
}

/** Actor identity and behaviour are assigned once by `planLot`. */
type RawAnim = Omit<AnimStamp, "actorId" | "behaviour">;
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
  const loading = (lot.layout?.bays ?? 1) > 1;
  const worked = lot.yard === "fully_dormant" || lot.yard.startsWith("prs_");
  const tile: SpriteBox = loading
    ? GROUND_TILES.asphaltSlab
    : worked
      ? LOT_TILE_DIRT
      : LOT_TILE_GRASS[index % LOT_TILE_GRASS.length];
  const bed = loading ? "5c6168" : worked ? "c9a06b" : "8fc46a";
  diamonds.push({
    kind: "diamond",
    x: x + 0.15,
    y: y + 0.15,
    w: LOT_W - 0.3,
    d: LOT_D - 0.3,
    fill: hex(bed),
    fillAlpha: 1,
    stroke: hex(loading ? "d4b45a" : "283c23"),
    strokeAlpha: loading ? 0.7 : 0.18,
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
    loading ? { repo: lot.fullName, tag: "loading-pad" } : undefined,
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
  anims: RawAnim[],
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
  anims: RawAnim[],
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
  anims: RawAnim[],
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
  anims: RawAnim[],
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
  anims: RawAnim[],
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

/** Default yard-local positions (world units from the yard origin) per prop. */
const DEFAULT_SLOTS: Record<string, { x: number; y: number }> = {
  "drafting-table": { x: 0.2, y: 0.7 },
  blueprint: { x: 0.95, y: 0.12 },
  materials: { x: 0.08, y: 0.08 },
  crew: { x: 0, y: 0 },
  drone: { x: 1.25, y: -0.2 },
  cones: { x: 1.55, y: 1.7 },
  lamp: { x: 1.7, y: 0.05 },
  bench: { x: 0.35, y: 1.85 },
  tree: { x: 1.6, y: 1.35 },
  bush: { x: 0.05, y: 1.6 },
  planter: { x: 1.1, y: 1.9 },
};

const DECOR_BOXES: Record<DecorPropName, { box: SpriteBox; width: number }> = {
  cones: { box: GROUND_TILES.cone, width: 20 },
  lamp: { box: GROUND_TILES.lampPost, width: 22 },
  bench: { box: GROUND_TILES.benchProp, width: 52 },
  tree: { box: GROUND_TILES.treeRoundA, width: 40 },
  bush: { box: GROUND_TILES.bushA, width: 38 },
  planter: { box: GROUND_TILES.sandTile, width: 34 },
};

function slotFor(lot: CityLot, prop: string): { x: number; y: number } {
  const explicit = lot.layout?.slots.find((s: YardSlot) => s.prop === prop);
  return explicit ? { x: explicit.x, y: explicit.y } : DEFAULT_SLOTS[prop];
}

function decorOps(
  yx: number,
  yy: number,
  lot: CityLot,
  images: ImageStamp[],
  depth: number,
): void {
  for (const prop of lot.extraProps ?? []) {
    const decor = DECOR_BOXES[prop];
    if (!decor) continue;
    const at = slotFor(lot, prop);
    const anchor = project(yx + at.x, yy + at.y);
    images.push(
      imageStamp(GROUND_SHEET, decor.box, anchor.sx, anchor.sy, decor.width, false, depth, "decor", {
        repo: lot.fullName,
        tag: `decor:${prop}`,
      }),
    );
  }
}

function yardOps(
  place: LotPlacement,
  images: ImageStamp[],
  anims: RawAnim[],
  ellipses: EllipseOp[],
  diamonds: DiamondOp[],
): void {
  const { lot } = place;
  const origin = yardOrigin(place.x, place.y);
  const yx = origin.x;
  const yy = origin.y;
  const depth = depthAt(place.x, place.y, 4);
  const at = (prop: string) => {
    const s = slotFor(lot, prop);
    return { x: yx + s.x, y: yy + s.y };
  };
  if (lot.showDraftingTable) {
    const p = at("drafting-table");
    draftingTableOp(p.x, p.y, lot, images, depth);
  }
  if (lot.showBlueprint) {
    const p = at("blueprint");
    blueprintOps(p.x, p.y, lot, images, anims, depth);
  }
  if (lot.showMaterials) {
    const p = at("materials");
    matsOps(p.x, p.y, lot, images, anims, depth);
    const bays = lot.layout?.bays ?? 1;
    if (bays > 1) {
      diamonds.push({
        kind: "diamond",
        x: place.x + 1.85,
        y: place.y + 0.22,
        w: 2.05,
        d: 2.05,
        fill: hex("5c6168"),
        fillAlpha: 0.95,
        stroke: hex("d4b45a"),
        strokeAlpha: 0.7,
        depth: -99_990,
      });
      const apron = project(yx + 1.05, yy + 1.15);
      images.push(
        imageStamp(GROUND_SHEET, GROUND_TILES.asphaltSlab, apron.sx, apron.sy, 128, false, depth - 1.2, "world", {
          repo: lot.fullName,
          tag: "loading-apron",
        }),
      );
    }
    for (let bay = 1; bay < bays; bay++) {
      const pallet = MATERIAL_PALLETS[(lot.buildingId + bay * 2) % MATERIAL_PALLETS.length];
      // Toward the camera (higher x+y) so extra bays are not hidden by the building.
      const a = project(place.x + 1.15 + bay * 0.85, place.y + 1.55 - bay * 0.12);
      images.push(
        imageStamp(PROP_SHEETS.materials, pallet, a.sx, a.sy, 78, !lot.recentActivity, depth + 0.2, "world", {
          repo: lot.fullName,
          tag: `bay:${bay + 1}`,
        }),
      );
    }
  }
  if (lot.showCrew) {
    const p = at("crew");
    crewOps(p.x, p.y, lot, images, anims, depth);
  }
  if (lot.yard === "idle_active") idleWalkerOp(yx, yy, lot, anims, depth);
  if (lot.showDrone) {
    const p = at("drone");
    droneOps(p.x, p.y, lot, images, anims, ellipses, depth);
  }
  decorOps(yx, yy, lot, images, depth);
  if (lot.dressingProp && lot.dressingProp !== "none") {
    const at = slotFor(lot, lot.dressingProp) ?? { x: 1.55, y: 1.55 };
    const anchor = project(yx + at.x, yy + at.y);
    const plant = CIVIC_PLANTS[lot.buildingId % CIVIC_PLANTS.length];
    const box =
      lot.dressingProp === "lamp"
        ? GROUND_TILES.lampPost
        : lot.dressingProp === "planter"
          ? GROUND_TILES.bushA
          : lot.dressingProp === "bush"
            ? GROUND_TILES.bushA
            : plant;
    const sheet = lot.dressingProp === "tree" ? CIVIC_SHEET : GROUND_SHEET;
    images.push(
      imageStamp(
        sheet,
        box,
        anchor.sx,
        anchor.sy,
        lot.dressingProp === "lamp" ? 14 : 36,
        false,
        depth,
        "decor",
        { repo: lot.fullName, tag: `dressing:${lot.dressingProp}` },
      ),
    );
  }
}

function buildingOp(place: LotPlacement, images: ImageStamp[]): void {
  const { lot } = place;
  const plant = buildingAnchor(place.x, place.y);
  const anchor = project(plant.x, plant.y);
  if (lot.artwork) {
    const box: SpriteBox = { x: 0, y: 0, w: lot.artwork.width, h: lot.artwork.height };
    const s = buildingSize(lot).width / box.w;
    images.push({
      kind: "image",
      sheet: `artwork:${lot.artwork.sha256}`,
      box,
      sx: anchor.sx,
      sy: anchor.sy,
      scaleX: s,
      scaleY: s,
      dimmed: !lot.recentActivity,
      depth: depthAt(place.x, place.y, 6),
      layer: "world",
      repo: lot.fullName,
      tag: "building",
      url: lot.artwork.url,
      tint: lot.facadeTint,
    });
    return;
  }
  const sheet = sheetForBand(
    lot.buildingId <= 17 ? "S" : lot.buildingId <= 34 ? "M" : "L",
  );
  const box = spriteBoxFor(lot.buildingId);
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
      { repo: lot.fullName, tag: "building", tint: lot.facadeTint },
    ),
  );
}

function roofOps(place: LotPlacement, images: ImageStamp[]): void {
  const { lot } = place;
  const bays = lot.layout?.bays ?? 1;
  const extras = lot.extraProps ?? [];
  if (bays <= 1 && extras.length === 0) return;
  const size = buildingSize(lot);
  const foot = project(place.x + 1, place.y + LOT_D / 2);
  const roofX = foot.sx;
  const roofY = foot.sy - size.height * 0.86;
  const depth = depthAt(place.x, place.y, 8);
  if (bays > 1) {
    images.push(
      imageStamp(
        CIVIC_SHEET,
        CIVIC_SPRITES["bank-office"],
        roofX,
        roofY + 28,
        58,
        false,
        depth,
        "world",
        { repo: lot.fullName, tag: "roof-sign" },
      ),
    );
    for (let bay = 1; bay < bays; bay++) {
      const pallet = MATERIAL_PALLETS[(lot.buildingId + bay * 3) % MATERIAL_PALLETS.length];
      images.push(
        imageStamp(
          PROP_SHEETS.materials,
          pallet,
          roofX - 36 + bay * 36,
          roofY + 52,
          68,
          false,
          depth,
          "world",
          { repo: lot.fullName, tag: `roof-bay:${bay + 1}` },
        ),
      );
    }
  }
  if (extras.includes("lamp")) {
    images.push(
      imageStamp(GROUND_SHEET, GROUND_TILES.lampPost, roofX + 24, roofY + 48, 20, false, depth, "decor", {
        repo: lot.fullName,
        tag: "roof-lamp",
      }),
    );
  }
  if (extras.includes("bench")) {
    images.push(
      imageStamp(GROUND_SHEET, GROUND_TILES.benchProp, roofX - 22, roofY + 52, 42, false, depth, "decor", {
        repo: lot.fullName,
        tag: "roof-bench",
      }),
    );
  }
}

/** Behaviour implied by a robot-atlas animation, used to pick the human equivalent. */
function behaviourOf(anim: string): ActorBehaviour {
  switch (anim) {
    case "cargoDrone":
      return "fly";
    case "craneArm":
    case "blueprint":
    case "humanWork":
      return "work";
    case "carryCrate":
    case "palletJack":
    case "platformRover":
    case "humanCarry":
      return "carry";
    case "humanWave":
      return "wave";
    default:
      return "walk";
  }
}

const HUMAN_ANIM: Partial<Record<ActorBehaviour, string>> = {
  walk: "humanWalk",
  work: "humanWork",
  carry: "humanCarry",
  wave: "humanWave",
};

/** Every sheet the Phaser preloader must fetch. */
export const CITY_ANIMATIONS = [
  "craneArm",
  "quadDog",
  "cargoDrone",
  "platformRover",
] as const;
export function requiredSheets(): string[] {
  const files = new Set<string>([
    BUILDING_SHEETS.S.file,
    BUILDING_SHEETS.M.file,
    BUILDING_SHEETS.L.file,
    GROUND_SHEET.file,
    CIVIC_SHEET.file,
    HUD_SHEET.file,
    PROP_SHEETS.materials.file,
    PROP_SHEETS.planning.file,
    PROP_SHEETS.crew.file,
    PROP_SHEETS.drones.file,
    WILD_SHEETS.trees.file,
  ]);
  for (const name of CITY_ANIMATIONS) files.add(ANIM_SHEETS[name].file);
  return [...files];
}

/**
 * Materialize one lot. The canonical world plan owns every address; this only
 * decides what stands on it. `detail=false` is an export-only still (no yard
 * props or actors) — the live scene always renders full detail and optimises
 * by reusing objects, not by dropping features.
 */
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
  const raw: RawAnim[] = [];
  lotTileOps(place, place.lot.buildingId, result.diamonds, result.images);
  buildingOp(place, result.images);
  if (detail) {
    yardOps(place, result.images, raw, result.ellipses, result.diamonds);
    roofOps(place, result.images);
  }
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
  const site = constructionState(place, now);
  if (site.stage !== "complete") {
    result.construction = site;
    if (building) building.alpha = Math.min(building.alpha ?? 1, site.buildingAlpha);
    const stageBox = CONSTRUCTION_STAGES[site.stage];
    if (stageBox) {
      const a = project(place.x + 1.0, place.y + LOT_D / 2);
      result.images.push(
        imageStamp(
          CIVIC_SHEET,
          stageBox,
          a.sx,
          a.sy,
          buildingSize(place.lot).width * 0.92,
          false,
          a.sy + 2,
          "world",
          { repo: place.lot.fullName, tag: "scaffold-art" },
        ),
      );
    }
    if (site.siteDressing) {
      result.diamonds.push({
        kind: "diamond",
        x: place.x + 0.2,
        y: place.y + 0.2,
        w: LOT_W - 0.4,
        d: LOT_D - 0.4,
        fill: hex("c9a06b"),
        fillAlpha: 1,
        stroke: hex("503214"),
        strokeAlpha: 0.25,
        depth: -99_995,
      });
      for (const [i, [cx, cy]] of [
        [0.35, 0.4],
        [3.4, 1.8],
        [3.1, 0.35],
      ].entries()) {
        const a = project(place.x + cx, place.y + cy);
        result.images.push(
          imageStamp(GROUND_SHEET, GROUND_TILES.cone, a.sx, a.sy, 18, false, a.sy, "world", {
            repo: place.lot.fullName,
            tag: `cone:${i}`,
          }),
        );
      }
    }
    if (site.crane) {
      const anchor = project(place.x + 0.4, place.y + 1.1);
      raw.push({
        kind: "anim",
        anim: "craneArm",
        sheet: ANIM_SHEETS.craneArm,
        sx: anchor.sx,
        sy: anchor.sy,
        targetW: place.lot.buildingBand === "L" ? 68 : place.lot.buildingBand === "M" ? 60 : 52,
        depth: anchor.sy + 15,
        phase: 0,
        repo: place.lot.fullName,
      });
    }
  }
  // Only yards with a crew, an idle walker, or air traffic animate; the rest are stills.
  let anims = raw.filter(
    (op) =>
      op.anim === "cargoDrone" ||
      op.anim === "craneArm" ||
      place.lot.showCrew ||
      place.lot.yard === "idle_active",
  );
  // Human (and mixed) crews are people with distinct behaviours; the robot atlas stays for bot yards.
  const humans = place.lot.occupantClass === "human" || place.lot.occupantClass === "mixed";
  if (humans) {
    const robots = place.lot.occupantClass === "mixed";
    anims = anims.map((op, index) => {
      const behaviour = behaviourOf(op.anim);
      const human = HUMAN_ANIM[behaviour];
      // A mixed crew keeps every other ground worker as a robot.
      if (!human || op.anim === "craneArm" || (robots && index % 2 === 1)) return op;
      return { ...op, anim: human, targetW: 18, pace: op.pace ? { ...op.pace, legs: 3 } : undefined };
    });
    if (place.lot.showCrew && place.lot.recentActivity) {
      const w = project(place.x + 3.55, place.y + 2.05);
      anims.push({
        kind: "anim",
        anim: "humanWave",
        sheet: ANIM_SHEETS.unitWalk,
        sx: w.sx,
        sy: w.sy,
        targetW: 18,
        depth: w.sy,
        phase: phaseFor(place.lot),
        repo: place.lot.fullName,
      });
    }
  }
  const counts = new Map<string, number>();
  result.anims = anims.map((op) => {
    const n = counts.get(op.anim) ?? 0;
    counts.set(op.anim, n + 1);
    return { ...op, actorId: `${place.lot.fullName}#${op.anim}:${n}`, behaviour: behaviourOf(op.anim) };
  });
  for (const image of result.images)
    if (image.layer === "world") image.depth = image.sy;
  for (const anim of result.anims)
    anim.depth = anim.sy + (anim.anim === "cargoDrone" ? 1000 : 0);
  return result;
}

/** Animations the client generates procedurally (people and vehicles). */
export const GENERATED_ANIMATIONS = [
  "humanWalk",
  "humanWork",
  "humanCarry",
  "humanWave",
  "car",
  "tram",
] as const;
