import { HIGH_PR_COUNT } from "../parser/thresholds.js";
import type { CityLot } from "../types.js";
import { project } from "../render/iso.js";
import {
  buildingAnchor,
  buildingTargetWidth,
  FOREST_BUSHES,
  FOREST_PAD_X,
  FOREST_PAD_Y,
  FOREST_STEP,
  FOREST_TREES,
  hash01,
  LOT_D,
  LOT_W,
  MARGIN,
  type LotPlacement,
  placeLots,
  ROAD_D,
  ROAD_TOP0,
  roadCenterY,
  STRIDE_X,
  STRIDE_Y,
  worldBounds,
  worldSize,
  yardOrigin,
} from "../render/layout.js";
import {
  ANIM_SHEETS,
  BUILDING_SHEETS,
  CONE_TILE,
  CREW_CARRY,
  CREW_WALK,
  DECOR_BENCH,
  DECOR_LAMP,
  DECOR_TREES,
  DRONE_QUADS,
  GROUND_SHEET,
  LOT_TILE_DIRT,
  LOT_TILE_GRASS,
  MANHOLE_TILE,
  MATERIAL_LOOSE,
  MATERIAL_PALLETS,
  PLANNING_SHEET,
  PLANNING_TABLES,
  PROP_SHEETS,
  ROAD_TILES,
  sheetForBand,
  spriteBoxFor,
  WILD_SHEETS,
  WILD_WATER,
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

export interface CityScenePlan {
  placements: LotPlacement[];
  world: ReturnType<typeof worldBounds>;
  worldW: number;
  worldH: number;
  rows: number;
  diamonds: DiamondOp[];
  ellipses: EllipseOp[];
  images: ImageStamp[];
  anims: AnimStamp[];
  hits: HitOp[];
}

function depthAt(wx: number, wy: number, bias = 0): number {
  return 100 + (wx + wy) * 20 + bias;
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

function streetOps(row: number, w: number, diamonds: DiamondOp[], images: ImageStamp[]): void {
  const top = ROAD_TOP0 + row * STRIDE_Y;
  const cy = top + ROAD_D / 2;
  diamonds.push({
    kind: "diamond",
    x: 0.6,
    y: top,
    w: w - 1.2,
    d: ROAD_D,
    fill: hex("4b525c"),
    fillAlpha: 1,
    stroke: hex("14181c"),
    strokeAlpha: 0.25,
    depth: 1,
  });
  let k = 0;
  for (let x = 1.2; x < w - 1.2; x += 1.0, k++) {
    const anchor = project(x, cy);
    if (k % 6 === 3) {
      images.push(
        imageStamp(GROUND_SHEET, MANHOLE_TILE, anchor.sx, anchor.sy, 30, false, 2, "ground"),
      );
    }
    const tile = ROAD_TILES[k % ROAD_TILES.length];
    const stamp = imageStamp(GROUND_SHEET, tile, anchor.sx, anchor.sy, 72, false, 2, "ground");
    stamp.scaleY = stamp.scaleX * 0.85;
    images.push(stamp);
  }
  const cone = project(w - 2.6 - (row % 2) * (w - 5.2), cy);
  images.push(imageStamp(GROUND_SHEET, CONE_TILE, cone.sx, cone.sy, 26, false, 3, "ground"));
}

function lotTileOps(place: LotPlacement, index: number, diamonds: DiamondOp[], images: ImageStamp[]): void {
  const { lot, x, y } = place;
  const worked = lot.yard === "fully_dormant" || lot.yard.startsWith("prs_");
  const tile: SpriteBox = worked ? LOT_TILE_DIRT : LOT_TILE_GRASS[index % LOT_TILE_GRASS.length];
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
    depth: 4,
  });
  const bc = project(x + LOT_W / 2, y + LOT_D);
  const stamp = imageStamp(GROUND_SHEET, tile, bc.sx, bc.sy, tile.w, false, 5, "ground");
  stamp.scaleX = ((LOT_W + LOT_D) * 36) / tile.w;
  stamp.scaleY = ((LOT_W + LOT_D) * 18) / tile.h;
  images.push(stamp);
}

function forestOps(w: number, h: number): Array<{ key: number; image: ImageStamp }> {
  const items: Array<{ key: number; image: ImageStamp }> = [];
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
      const depth = depthAt(jx, jy);
      if (hash01(ix, iy, 23) < 0.62) {
        const box = FOREST_TREES[Math.floor(variant * FOREST_TREES.length) % FOREST_TREES.length];
        const targetH = 76 + size * 52;
        const targetW = (box.w * targetH) / box.h;
        items.push({
          key: jx + jy,
          image: imageStamp(
            WILD_SHEETS.trees,
            box,
            anchor.sx,
            anchor.sy,
            targetW,
            false,
            depth,
            "world",
            { tag: "wild-tree" },
          ),
        });
      } else {
        const box = FOREST_BUSHES[Math.floor(variant * FOREST_BUSHES.length) % FOREST_BUSHES.length];
        const targetH = 30 + size * 22;
        const targetW = (box.w * targetH) / box.h;
        items.push({
          key: jx + jy,
          image: imageStamp(
            WILD_SHEETS.bushes,
            box,
            anchor.sx,
            anchor.sy,
            targetW,
            false,
            depth,
            "world",
            { tag: "wild-bush", pixelated: true },
          ),
        });
      }
    }
  }
  return items;
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
  images.push(imageStamp(sheet, PLANNING_SHEET, anchor.sx, anchor.sy, 46, dim, depth, "world", { repo: lot.fullName }));
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

function draftingTableOp(x: number, y: number, lot: CityLot, images: ImageStamp[], depth: number): void {
  const sheet = PROP_SHEETS.planning;
  const anchor = project(x + 0.42, y + 0.44);
  const table = PLANNING_TABLES[lot.buildingId % PLANNING_TABLES.length];
  images.push(
    imageStamp(sheet, table, anchor.sx, anchor.sy, 62, !lot.recentActivity, depth, "world", {
      repo: lot.fullName,
    }),
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
    const secondary = MATERIAL_LOOSE[(lot.buildingId + 3) % MATERIAL_LOOSE.length];
    images.push(
      imageStamp(sheet, secondary, a2.sx, a2.sy, 40, dim, depth, "world", { repo: lot.fullName }),
    );
  }
  images.push(imageStamp(sheet, primary, a1.sx, a1.sy, 56, dim, depth + 0.2, "world", { repo: lot.fullName }));
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
    imageStamp(sheet, walker, a1.sx, a1.sy, walker.w * (crewH / walker.h), false, depth, "world", {
      repo: lot.fullName,
    }),
  );
  images.push(
    imageStamp(sheet, carrier, a2.sx, a2.sy, carrier.w * (crewH / carrier.h), false, depth, "world", {
      repo: lot.fullName,
    }),
  );
}

function idleWalkerOp(x: number, y: number, lot: CityLot, anims: AnimStamp[], depth: number): void {
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
    imageStamp(sheet, quad, anchor.sx, anchor.sy - 42, 52, true, depth + 8, "world", {
      repo: lot.fullName,
    }),
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
  if (lot.showDraftingTable) draftingTableOp(yx + 0.2, yy + 0.7, lot, images, depth);
  if (lot.showBlueprint) blueprintOps(yx + 0.95, yy + 0.12, lot, images, anims, depth);
  if (lot.showMaterials) matsOps(yx + 0.08, yy + 0.08, lot, images, anims, depth);
  if (lot.showCrew) crewOps(yx, yy, lot, images, anims, depth);
  if (lot.yard === "idle_active") idleWalkerOp(yx, yy, lot, anims, depth);
  if (lot.showDrone) droneOps(yx + 1.25, yy - 0.2, lot, images, anims, ellipses, depth);
}

function buildingOp(place: LotPlacement, images: ImageStamp[]): void {
  const { lot } = place;
  const sheet = sheetForBand(lot.buildingBand);
  const box = spriteBoxFor(lot.buildingId);
  const plant = buildingAnchor(place.x, place.y);
  const anchor = project(plant.x, plant.y);
  images.push(
    imageStamp(
      sheet,
      box,
      anchor.sx,
      anchor.sy,
      buildingTargetWidth(lot.buildingBand),
      !lot.recentActivity,
      depthAt(place.x, place.y, 6),
      "world",
      { repo: lot.fullName, tag: "building" },
    ),
  );
}

function streetWalkerOp(row: number, w: number, anims: AnimStamp[]): number {
  const cy = roadCenterY(row);
  const east = row % 2 === 0;
  const wx = east ? 2.4 : w - 2.4;
  const anchor = project(wx, cy);
  const dx = east ? 100 : -100;
  anims.push({
    kind: "anim",
    anim: east ? "unitWalk" : "carryCrate",
    sheet: east ? ANIM_SHEETS.unitWalk : ANIM_SHEETS.carryCrate,
    sx: anchor.sx,
    sy: anchor.sy,
    targetW: 50,
    depth: depthAt(wx, cy, 3),
    phase: -row * 1.3,
    pace: { dx, dy: dx / 2, legs: 3 },
  });
  return wx + cy;
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

/**
 * Phaser-agnostic scene graph. Same projector, lots, dual-plot tiles, yard
 * props, and forest ring as the SVG renderer — the game client just stamps
 * texture frames instead of clip-path images.
 */
export function planCityScene(lots: CityLot[]): CityScenePlan {
  const placements = placeLots(lots);
  const { w, h, rows } = worldSize(lots.length);
  const diamonds: DiamondOp[] = [];
  const images: ImageStamp[] = [];
  const anims: AnimStamp[] = [];
  const ellipses: EllipseOp[] = [];
  const hits: HitOp[] = [];

  diamonds.push({
    kind: "diamond",
    x: -FOREST_PAD_X,
    y: -FOREST_PAD_Y,
    w: w + FOREST_PAD_X * 2,
    d: h + FOREST_PAD_Y * 2,
    fill: hex("7fbe56"),
    fillAlpha: 1,
    stroke: hex("28461e"),
    strokeAlpha: 0.16,
    depth: 0,
  });
  diamonds.push({
    kind: "diamond",
    x: -FOREST_PAD_X + 0.35,
    y: -FOREST_PAD_Y + 0.35,
    w: w + FOREST_PAD_X * 2 - 0.7,
    d: h + FOREST_PAD_Y * 2 - 0.7,
    fill: hex("86c55c"),
    fillAlpha: 1,
    stroke: hex("28461e"),
    strokeAlpha: 0.08,
    depth: 0,
  });

  for (let r = 0; r <= rows; r++) streetOps(r, w, diamonds, images);

  diamonds.push({
    kind: "diamond",
    x: w - 2.2,
    y: h - 2.0,
    w: 2.0,
    d: 1.7,
    fill: hex("4ea2d6"),
    fillAlpha: 1,
    stroke: hex("14466e"),
    strokeAlpha: 0.2,
    depth: 1,
  });
  const pond = project(w - 0.2, h - 0.3);
  images.push(
    imageStamp(WILD_SHEETS.bushes, WILD_WATER, pond.sx, pond.sy, 132, false, 2, "ground", {
      tag: "pond",
    }),
  );

  placements.forEach((place, i) => lotTileOps(place, i, diamonds, images));

  const trees: Array<[number, number]> = [
    [0.45, 0.45],
    [w - 1.1, 0.5],
    [0.5, h - 1.3],
    [w - 2.6, h - 2.3],
  ];
  trees.forEach(([x, y], i) => {
    const tile = DECOR_TREES[i % DECOR_TREES.length];
    const anchor = project(x, y);
    images.push(imageStamp(GROUND_SHEET, tile, anchor.sx, anchor.sy, 64, false, 8, "decor"));
  });
  for (const x of [MARGIN + STRIDE_X - 0.35, MARGIN + 2 * STRIDE_X - 0.35]) {
    const lamp = project(x, MARGIN - 0.45);
    images.push(imageStamp(GROUND_SHEET, DECOR_LAMP, lamp.sx, lamp.sy, 26, false, 8, "decor"));
  }
  const bench = project(MARGIN + STRIDE_X + 0.15, MARGIN + LOT_D + 0.15);
  images.push(imageStamp(GROUND_SHEET, DECOR_BENCH, bench.sx, bench.sy, 84, false, 8, "decor"));

  for (const place of placements) {
    buildingOp(place, images);
    yardOps(place, images, anims, ellipses);
    hits.push({ kind: "hit", repo: place.lot.fullName, x: place.x, y: place.y, w: 4, d: LOT_D });
  }

  for (let r = 0; r <= rows; r++) streetWalkerOp(r, w, anims);

  for (const item of forestOps(w, h)) images.push(item.image);

  return {
    placements,
    world: worldBounds(w, h),
    worldW: w,
    worldH: h,
    rows,
    diamonds,
    ellipses,
    images,
    anims,
    hits,
  };
}

export function lotByRepo(plan: CityScenePlan, repo: string): LotPlacement | undefined {
  return plan.placements.find((p) => p.lot.fullName === repo);
}
