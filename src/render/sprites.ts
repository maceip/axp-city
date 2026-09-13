import type { BuildingBand } from "../types.js";
import { fmt } from "./iso.js";

/**
 * Measured sprite atlas: which pixel box holds each building catalog id.
 *
 * Measured with /tmp/slice_v2.py (connected components on a near-white
 * mask, overlap merging for glass interiors, row-boundary splits, tallest
 * content-run top trim). Sheet backgrounds are flood-keyed to transparent
 * (scripts/key_sheets.py), so stamps occlude with normal compositing; only
 * the building pixels need boxing — backing up into cleared margin is
 * harmless.
 *
 * One hand-set top: 50 → y 542 (row-4 top edge). The measurer clipped it
 * to y 629 on pale glass that falls below the occupancy threshold; the rows
 * above hold no title or number ink (row-3 numbers sit left of x1007), so
 * extending into them can only add real gem pixels or invisible glass.
 * (45 keeps its measured top: extending it would re-include row-2's "41"
 * number ink that the trim correctly excluded.)
 */
export interface SpriteSheet {
  file: string;
  width: number;
  height: number;
}

export interface SpriteBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const BUILDING_SHEETS: Record<BuildingBand, SpriteSheet> = {
  S: { file: "buildings-small-01-17-k1.png", width: 1280, height: 720 },
  M: { file: "buildings-medium-18-34-k1.png", width: 1280, height: 720 },
  L: { file: "buildings-large-35-50-k1.png", width: 1280, height: 720 },
};

export const BUILDING_SPRITES: Record<number, SpriteBox> = {
  1: { x: 138, y: 94, w: 152, h: 118 },
  2: { x: 341, y: 86, w: 165, h: 127 },
  3: { x: 559, y: 77, w: 155, h: 137 },
  4: { x: 769, y: 76, w: 147, h: 136 },
  5: { x: 977, y: 71, w: 154, h: 144 },
  6: { x: 142, y: 241, w: 140, h: 129 },
  7: { x: 346, y: 247, w: 157, h: 123 },
  8: { x: 565, y: 241, w: 140, h: 129 },
  9: { x: 763, y: 239, w: 161, h: 132 },
  10: { x: 973, y: 257, w: 161, h: 114 },
  11: { x: 139, y: 403, w: 145, h: 130 },
  12: { x: 345, y: 411, w: 153, h: 121 },
  13: { x: 564, y: 395, w: 145, h: 136 },
  14: { x: 764, y: 397, w: 155, h: 135 },
  15: { x: 982, y: 409, w: 142, h: 123 },
  16: { x: 141, y: 559, w: 148, h: 124 },
  17: { x: 567, y: 552, w: 136, h: 132 },
  18: { x: 82, y: 62, w: 190, h: 119 },
  19: { x: 320, y: 62, w: 164, h: 121 },
  20: { x: 551, y: 62, w: 167, h: 123 },
  21: { x: 776, y: 62, w: 191, h: 124 },
  22: { x: 1016, y: 62, w: 171, h: 123 },
  23: { x: 80, y: 205, w: 181, h: 154 },
  24: { x: 314, y: 201, w: 169, h: 159 },
  25: { x: 539, y: 207, w: 191, h: 153 },
  26: { x: 773, y: 217, w: 190, h: 145 },
  27: { x: 1003, y: 214, w: 198, h: 147 },
  28: { x: 79, y: 379, w: 172, h: 152 },
  29: { x: 302, y: 385, w: 192, h: 146 },
  30: { x: 422, y: 386, w: 308, h: 145 },
  31: { x: 660, y: 376, w: 297, h: 155 },
  32: { x: 1010, y: 384, w: 179, h: 141 },
  33: { x: 422, y: 539, w: 308, h: 149 },
  34: { x: 660, y: 542, w: 297, h: 147 },
  35: { x: 226, y: 62, w: 114, h: 112 },
  36: { x: 441, y: 62, w: 152, h: 111 },
  37: { x: 683, y: 62, w: 133, h: 113 },
  38: { x: 903, y: 62, w: 177, h: 115 },
  39: { x: 213, y: 198, w: 138, h: 157 },
  40: { x: 462, y: 203, w: 107, h: 151 },
  41: { x: 696, y: 193, w: 104, h: 160 },
  42: { x: 889, y: 208, w: 203, h: 150 },
  43: { x: 185, y: 390, w: 192, h: 127 },
  44: { x: 425, y: 369, w: 189, h: 151 },
  45: { x: 704, y: 416, w: 87, h: 105 },
  46: { x: 898, y: 379, w: 176, h: 142 },
  47: { x: 210, y: 533, w: 400, h: 160 },
  48: { x: 654, y: 550, w: 192, h: 144 },
  49: { x: 924, y: 542, w: 83, h: 149 },
  50: { x: 1007, y: 542, w: 104, h: 149 },
};

export function sheetForBand(band: BuildingBand): SpriteSheet {
  return BUILDING_SHEETS[band];
}

export function spriteBoxFor(id: number): SpriteBox {
  const box = BUILDING_SPRITES[id];
  if (!box) throw new Error(`Unknown building sprite id: ${id}`);
  return box;
}

export interface SpritePlacement {
  imgX: number;
  imgY: number;
  imgW: number;
  imgH: number;
  clipX: number;
  clipY: number;
  clipW: number;
  clipH: number;
}

/**
 * Map a sprite cell onto a lot footprint. The cell is width-normalized to
 * the lot's screen footprint (230.4px) and its bottom-center lands on the
 * pad center, so every catalog building stands on the pad at lot scale.
 */
export function spritePlacement(
  sheet: SpriteSheet,
  box: SpriteBox,
  lotX: number,
  lotY: number,
): SpritePlacement {
  return propPlacement(
    sheet,
    box,
    (lotX - lotY - 0.2) * 36,
    (lotX + lotY + 2.2) * 18,
    230.4,
  );
}

/** Anchor a prop box bottom-center on a screen point at a target width. */
export function propPlacement(
  sheet: { width: number; height: number },
  box: SpriteBox,
  anchorX: number,
  anchorY: number,
  targetW: number,
): SpritePlacement {
  const s = targetW / box.w;
  const imgW = sheet.width * s;
  const imgH = sheet.height * s;
  const imgX = anchorX - (box.x + box.w / 2) * s;
  const imgY = anchorY - (box.y + box.h) * s;
  return {
    imgX,
    imgY,
    imgW,
    imgH,
    clipX: imgX + box.x * s,
    clipY: imgY + box.y * s,
    clipW: box.w * s,
    clipH: box.h * s,
  };
}

export type StampFn = (
  file: string,
  sheet: { width: number; height: number },
  box: SpriteBox,
  anchorX: number,
  anchorY: number,
  targetW: number,
  dimmed: boolean,
) => string;

/**
 * Yard prop atlas. Measured with /tmp/slice_props.py (connected components;
 * crew columns force-split at row bands and shrink-wrapped per figure).
 * All sheets are 1280x720 with flood-keyed backgrounds, stamped like the
 * buildings above.
 */
export interface PropSheet {
  file: string;
  width: number;
  height: number;
}

export const PROP_SHEETS: Record<string, PropSheet> = {
  materials: { file: "v2-raw-materials-k1.png", width: 1280, height: 720 },
  planning: { file: "v2-planning-issues-k1.png", width: 1280, height: 720 },
  crew: { file: "v3-robot-crew-k1.png", width: 1280, height: 720 },
  drones: { file: "v3-agent-drones-k1.png", width: 1280, height: 720 },
};

export const PROP_BOXES: Record<string, SpriteBox> = {
  brickPallet: { x: 21, y: 69, w: 196, h: 189 },
  cinderPallet: { x: 237, y: 69, w: 186, h: 189 },
  plywoodPallet: { x: 440, y: 78, w: 207, h: 186 },
  slabStack: { x: 662, y: 82, w: 199, h: 179 },
  pipeStack: { x: 868, y: 86, w: 198, h: 172 },
  gravelPile: { x: 1076, y: 107, w: 185, h: 143 },
  sandPile: { x: 17, y: 324, w: 183, h: 138 },
  brickPile: { x: 220, y: 308, w: 196, h: 167 },
  lumberStack: { x: 434, y: 297, w: 211, h: 185 },
  roofTiles: { x: 661, y: 313, w: 179, h: 165 },
  rebarBundle: { x: 860, y: 322, w: 203, h: 155 },
  cementBags: { x: 1087, y: 302, w: 172, h: 177 },
  wheelbarrow: { x: 415, y: 518, w: 217, h: 154 },
  mixer: { x: 682, y: 502, w: 168, h: 187 },
  flatSheet: { x: 23, y: 50, w: 420, h: 304 },
  tableA: { x: 453, y: 37, w: 245, h: 296 },
  tableB: { x: 720, y: 54, w: 264, h: 299 },
  desk: { x: 999, y: 38, w: 249, h: 351 },
  roll: { x: 58, y: 414, w: 268, h: 194 },
  clipboard: { x: 382, y: 385, w: 269, h: 255 },
  trailer: { x: 714, y: 381, w: 252, h: 247 },
  tripod: { x: 1026, y: 393, w: 143, h: 257 },
  idleWhite: { x: 262, y: 6, w: 82, h: 133 },
  idle34: { x: 492, y: 6, w: 77, h: 134 },
  idleSide: { x: 738, y: 6, w: 49, h: 133 },
  walk1: { x: 256, y: 144, w: 94, h: 140 },
  walk2: { x: 474, y: 144, w: 89, h: 141 },
  walk3: { x: 687, y: 144, w: 188, h: 146 },
  carryWhite: { x: 910, y: 142, w: 98, h: 147 },
  tableBot: { x: 243, y: 291, w: 158, h: 140 },
  point: { x: 502, y: 290, w: 130, h: 141 },
  wave: { x: 714, y: 290, w: 160, h: 131 },
  idleOlive: { x: 259, y: 431, w: 79, h: 140 },
  walkOlive1: { x: 467, y: 431, w: 99, h: 140 },
  walkOlive2: { x: 684, y: 431, w: 95, h: 140 },
  carryOlive: { x: 915, y: 431, w: 103, h: 123 },
  idleWhite2: { x: 264, y: 571, w: 79, h: 119 },
  idleOlive2: { x: 447, y: 571, w: 79, h: 120 },
  cart: { x: 695, y: 571, w: 209, h: 139 },
  quadScout: { x: 27, y: 69, w: 306, h: 166 },
  quadTeal: { x: 342, y: 80, w: 291, h: 195 },
  quadCarry: { x: 646, y: 60, w: 295, h: 324 },
  quadA: { x: 941, y: 60, w: 311, h: 324 },
  roverScout: { x: 71, y: 395, w: 215, h: 202 },
  roverArm: { x: 351, y: 373, w: 249, h: 240 },
  roverHaul: { x: 656, y: 421, w: 245, h: 193 },
  roverTeal: { x: 959, y: 407, w: 240, h: 217 },
};

function propBox(name: string): SpriteBox {
  const box = PROP_BOXES[name];
  if (!box) throw new Error(`Unknown prop sprite: ${name}`);
  return box;
}

/** Structured pallet/stack per lot (stable variety), loose piles for density. */
export const MATERIAL_PALLETS = [
  "brickPallet",
  "cinderPallet",
  "plywoodPallet",
  "slabStack",
  "pipeStack",
  "lumberStack",
].map(propBox);
export const MATERIAL_LOOSE = [
  "gravelPile",
  "sandPile",
  "brickPile",
  "roofTiles",
  "rebarBundle",
  "cementBags",
].map(propBox);
export const PLANNING_TABLES = ["tableA", "tableB"].map(propBox);
export const PLANNING_SHEET = propBox("flatSheet");
export const CREW_WALK = ["walk1", "walk2", "walk3", "walkOlive1", "walkOlive2"].map(propBox);
export const CREW_CARRY = ["carryWhite", "carryOlive", "cart"].map(propBox);
export const DRONE_QUADS = ["quadScout", "quadTeal", "quadCarry", "quadA"].map(propBox);

/**
 * Ground / environment tile kit (v5-ground-tiles-kit-k1.png). Measured with the
 * same connected-components pass as the yard sheets (see /tmp/slice_lib.py);
 * text labels excluded by size, tile boxes assigned in visual reading order.
 * Flood-keyed background, stamped like everything above.
 */
export const GROUND_SHEET: PropSheet = {
  file: "v5-ground-tiles-kit-k1.png",
  width: 1280,
  height: 720,
};

export const GROUND_TILES: Record<string, SpriteBox> = {
  grassA: { x: 22, y: 35, w: 165, h: 106 },
  grassB: { x: 210, y: 35, w: 163, h: 107 },
  grassC: { x: 394, y: 35, w: 165, h: 107 },
  dirtA: { x: 602, y: 45, w: 140, h: 85 },
  dirtB: { x: 757, y: 45, w: 141, h: 86 },
  paveA: { x: 919, y: 39, w: 156, h: 100 },
  paveB: { x: 1091, y: 38, w: 158, h: 102 },
  roadPlain: { x: 26, y: 182, w: 146, h: 96 },
  roadDashed: { x: 190, y: 181, w: 144, h: 97 },
  roadCorner: { x: 351, y: 181, w: 140, h: 95 },
  roadCross: { x: 514, y: 185, w: 173, h: 94 },
  roadStraight: { x: 712, y: 183, w: 142, h: 96 },
  roadCurve: { x: 903, y: 185, w: 159, h: 94 },
  grassD: { x: 1089, y: 184, w: 152, h: 99 },
  dualGrassA: { x: 24, y: 317, w: 246, h: 96 },
  dualGrassB: { x: 301, y: 317, w: 253, h: 96 },
  dualDirt: { x: 592, y: 318, w: 254, h: 95 },
  waterTile: { x: 905, y: 320, w: 151, h: 99 },
  sandTile: { x: 1088, y: 321, w: 151, h: 98 },
  parkSteps: { x: 25, y: 436, w: 161, h: 122 },
  parkGrass: { x: 224, y: 450, w: 166, h: 110 },
  curbPiece: { x: 481, y: 473, w: 129, h: 56 },
  asphaltSlab: { x: 651, y: 456, w: 149, h: 97 },
  cliffCorner: { x: 862, y: 459, w: 189, h: 92 },
  snowGrid: { x: 1087, y: 458, w: 144, h: 94 },
  treeRoundA: { x: 49, y: 588, w: 74, h: 101 },
  treeRoundB: { x: 181, y: 588, w: 73, h: 101 },
  pineA: { x: 314, y: 582, w: 61, h: 107 },
  pineB: { x: 442, y: 584, w: 57, h: 105 },
  bushA: { x: 547, y: 612, w: 104, h: 76 },
  lampPost: { x: 726, y: 591, w: 31, h: 97 },
  cone: { x: 845, y: 615, w: 56, h: 69 },
  benchProp: { x: 968, y: 605, w: 96, h: 85 },
  manhole: { x: 1125, y: 620, w: 88, h: 64 },
};

function groundBox(name: string): SpriteBox {
  const box = GROUND_TILES[name];
  if (!box) throw new Error(`Unknown ground tile: ${name}`);
  return box;
}

/** Map-corner decor: real tree / lamp / bench art from the ground kit. */
export const DECOR_TREES = ["treeRoundA", "pineA", "treeRoundB", "pineB"].map(groundBox);
export const DECOR_LAMP = groundBox("lampPost");
export const DECOR_BENCH = groundBox("benchProp");

/**
 * Streets and lot bases from the ground kit. ROAD_TILES alternate along a
 * street run; the dual-plot tiles stamp one connected pad+yard per lot
 * (concrete production pad on the art's left, yard on the right).
 */
export const ROAD_TILES = ["roadPlain", "roadDashed"].map(groundBox);
export const LOT_TILE_GRASS = ["dualGrassA", "dualGrassB"].map(groundBox);
export const LOT_TILE_DIRT = groundBox("dualDirt");
export const MANHOLE_TILE = groundBox("manhole");
export const CONE_TILE = groundBox("cone");

/**
 * Animated crew atlases (v6-anim-*.png, transparent RGBA). Regular row-major
 * grids of 384px cells; only the first `frames` cells hold art (verified via
 * alpha occupancy — trailing cells are empty). Intended playback ~8 fps.
 */
export interface AnimSheet {
  file: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  frames: number;
  fps: number;
}

export const ANIM_SHEETS: Record<string, AnimSheet> = {
  unitWalk: {
    file: "v6-anim-unit-walk.png",
    width: 2304,
    height: 2304,
    cols: 6,
    rows: 6,
    frames: 34,
    fps: 8,
  },
  carryCrate: {
    file: "v6-anim-carry-crate.png",
    width: 2304,
    height: 1152,
    cols: 6,
    rows: 3,
    frames: 18,
    fps: 8,
  },
  blueprint: {
    file: "v6-anim-blueprint.png",
    width: 2304,
    height: 1920,
    cols: 6,
    rows: 5,
    frames: 26,
    fps: 8,
  },
  palletJack: {
    file: "v6-anim-pallet-jack.png",
    width: 2304,
    height: 1536,
    cols: 6,
    rows: 4,
    frames: 19,
    fps: 8,
  },
  craneArm: {
    file: "v7-anim-crane-arm.png",
    width: 2304,
    height: 2304,
    cols: 6,
    rows: 6,
    frames: 34,
    fps: 8,
  },
  quadDog: {
    file: "v7-anim-quad-dog.png",
    width: 2304,
    height: 2304,
    cols: 6,
    rows: 6,
    frames: 32,
    fps: 8,
  },
  cargoDrone: {
    file: "v7-anim-cargo-drone.png",
    width: 2304,
    height: 1152,
    cols: 6,
    rows: 3,
    frames: 16,
    fps: 8,
  },
  platformRover: {
    file: "v7-anim-platform-rover.png",
    width: 2304,
    height: 1152,
    cols: 6,
    rows: 3,
    frames: 16,
    fps: 8,
  },
};

export function animSheet(name: string): AnimSheet {
  const sheet = ANIM_SHEETS[name];
  if (!sheet) throw new Error(`Unknown anim sheet: ${name}`);
  return sheet;
}

/**
 * Wild foliage sheets (unprocessed/scenery-trees.png + bushes.png, black
 * backgrounds flood-keyed via scripts/key_black.py). Trees sliced as
 * connected components (one whole tree each); the tiny bush grid sliced as
 * projection cells (some are natural pairs/hedge rows). Stamped
 * height-normalized in the forest ring around the island.
 */
export const WILD_SHEETS = {
  trees: { file: "v8-wild-trees-k1.png", width: 1369, height: 2105 },
  bushes: { file: "v8-wild-bushes-k1.png", width: 128, height: 352 },
};

export const WILD_TREES: SpriteBox[] = [
 { x: 5, y: 5, w: 31, h: 27 },
 { x: 41, y: 5, w: 31, h: 27 },
 { x: 10, y: 60, w: 32, h: 143 },
 { x: 117, y: 60, w: 32, h: 105 },
 { x: 232, y: 60, w: 62, h: 112 },
 { x: 357, y: 60, w: 63, h: 122 },
 { x: 464, y: 60, w: 35, h: 124 },
 { x: 572, y: 62, w: 62, h: 95 },
 { x: 715, y: 60, w: 32, h: 117 },
 { x: 830, y: 60, w: 47, h: 71 },
 { x: 892, y: 61, w: 25, h: 68 },
 { x: 1008, y: 62, w: 42, h: 57 },
 { x: 1143, y: 60, w: 50, h: 127 },
 { x: 1244, y: 60, w: 64, h: 166 },
 { x: 1009, y: 127, w: 39, h: 56 },
 { x: 893, y: 135, w: 22, h: 70 },
 { x: 830, y: 138, w: 47, h: 67 },
 { x: 573, y: 167, w: 60, h: 90 },
 { x: 117, y: 170, w: 32, h: 105 },
 { x: 232, y: 180, w: 62, h: 107 },
 { x: 715, y: 185, w: 32, h: 111 },
 { x: 357, y: 191, w: 63, h: 114 },
 { x: 465, y: 189, w: 32, h: 124 },
 { x: 1008, y: 190, w: 42, h: 60 },
 { x: 1143, y: 192, w: 50, h: 127 },
 { x: 10, y: 210, w: 32, h: 139 },
 { x: 892, y: 211, w: 24, h: 68 },
 { x: 830, y: 212, w: 47, h: 71 },
 { x: 1244, y: 231, w: 64, h: 166 },
 { x: 1008, y: 260, w: 41, h: 50 },
 { x: 572, y: 266, w: 62, h: 98 },
 { x: 117, y: 282, w: 32, h: 101 },
 { x: 830, y: 290, w: 47, h: 67 },
 { x: 892, y: 288, w: 25, h: 65 },
 { x: 232, y: 296, w: 62, h: 109 },
 { x: 715, y: 306, w: 32, h: 113 },
 { x: 357, y: 314, w: 63, h: 122 },
 { x: 464, y: 318, w: 35, h: 124 },
 { x: 1143, y: 324, w: 50, h: 127 },
 { x: 10, y: 356, w: 32, h: 143 },
 { x: 573, y: 372, w: 60, h: 92 },
 { x: 117, y: 392, w: 32, h: 100 },
 { x: 1244, y: 402, w: 64, h: 166 },
 { x: 232, y: 413, w: 62, h: 108 },
 { x: 715, y: 426, w: 32, h: 116 },
 { x: 357, y: 445, w: 63, h: 114 },
 { x: 465, y: 447, w: 32, h: 124 },
 { x: 1143, y: 458, w: 50, h: 123 },
 { x: 10, y: 506, w: 32, h: 138 },
 { x: 1244, y: 573, w: 64, h: 166 },
 { x: 11, y: 772, w: 49, h: 121 },
 { x: 81, y: 772, w: 32, h: 118 },
 { x: 152, y: 772, w: 64, h: 120 },
 { x: 265, y: 773, w: 62, h: 81 },
 { x: 359, y: 773, w: 64, h: 157 },
 { x: 445, y: 772, w: 62, h: 101 },
 { x: 560, y: 772, w: 61, h: 139 },
 { x: 661, y: 772, w: 64, h: 83 },
 { x: 755, y: 774, w: 26, h: 110 },
 { x: 872, y: 774, w: 57, h: 81 },
 { x: 970, y: 772, w: 41, h: 69 },
 { x: 1037, y: 773, w: 58, h: 51 },
 { x: 1117, y: 775, w: 64, h: 77 },
 { x: 1229, y: 772, w: 64, h: 143 },
 { x: 1039, y: 831, w: 54, h: 51 },
 { x: 971, y: 846, w: 39, h: 69 },
 { x: 268, y: 860, w: 56, h: 83 },
 { x: 663, y: 860, w: 61, h: 83 },
 { x: 872, y: 862, w: 57, h: 82 },
 { x: 1117, y: 861, w: 64, h: 81 },
 { x: 446, y: 880, w: 61, h: 97 },
 { x: 1038, y: 889, w: 57, h: 51 },
 { x: 755, y: 892, w: 26, h: 112 },
 { x: 81, y: 898, w: 32, h: 113 },
 { x: 11, y: 902, w: 49, h: 112 },
 { x: 152, y: 901, w: 64, h: 112 },
 { x: 565, y: 918, w: 50, h: 135 },
 { x: 970, y: 922, w: 41, h: 64 },
 { x: 1231, y: 920, w: 61, h: 142 },
 { x: 361, y: 936, w: 61, h: 157 },
 { x: 1037, y: 946, w: 58, h: 53 },
 { x: 266, y: 949, w: 61, h: 81 },
 { x: 662, y: 948, w: 63, h: 83 },
 { x: 872, y: 951, w: 57, h: 82 },
 { x: 1119, y: 950, w: 61, h: 78 },
 { x: 445, y: 986, w: 62, h: 96 },
 { x: 971, y: 994, w: 39, h: 69 },
 { x: 755, y: 1014, w: 26, h: 107 },
 { x: 82, y: 1019, w: 30, h: 116 },
 { x: 157, y: 1022, w: 56, h: 120 },
 { x: 11, y: 1024, w: 49, h: 121 },
 { x: 265, y: 1039, w: 62, h: 77 },
 { x: 662, y: 1036, w: 63, h: 83 },
 { x: 873, y: 1039, w: 55, h: 84 },
 { x: 1117, y: 1036, w: 64, h: 83 },
 { x: 560, y: 1062, w: 60, h: 135 },
 { x: 1230, y: 1068, w: 62, h: 143 },
 { x: 446, y: 1090, w: 61, h: 101 },
 { x: 359, y: 1098, w: 64, h: 158 },
 { x: 755, y: 1129, w: 26, h: 114 },
 { x: 81, y: 1144, w: 32, h: 112 },
 { x: 11, y: 1153, w: 49, h: 115 },
 { x: 155, y: 1152, w: 57, h: 110 },
 { x: 564, y: 1205, w: 53, h: 136 },
 { x: 1230, y: 1216, w: 62, h: 143 },
 { x: 361, y: 1261, w: 61, h: 158 },
 { x: 10, y: 1455, w: 56, h: 77 },
 { x: 124, y: 1452, w: 63, h: 76 },
 { x: 226, y: 1452, w: 44, h: 136 },
 { x: 335, y: 1454, w: 61, h: 79 },
 { x: 411, y: 1452, w: 56, h: 56 },
 { x: 530, y: 1452, w: 64, h: 122 },
 { x: 630, y: 1452, w: 64, h: 157 },
 { x: 732, y: 1452, w: 60, h: 130 },
 { x: 838, y: 1452, w: 55, h: 68 },
 { x: 912, y: 1453, w: 49, h: 67 },
 { x: 980, y: 1454, w: 54, h: 79 },
 { x: 1079, y: 1452, w: 53, h: 81 },
 { x: 1176, y: 1452, w: 57, h: 155 },
 { x: 1248, y: 1452, w: 53, h: 72 },
 { x: 1316, y: 1453, w: 42, h: 69 },
 { x: 414, y: 1513, w: 52, h: 56 },
 { x: 908, y: 1525, w: 53, h: 68 },
 { x: 1317, y: 1527, w: 40, h: 70 },
 { x: 844, y: 1530, w: 45, h: 61 },
 { x: 1251, y: 1531, w: 47, h: 69 },
 { x: 127, y: 1534, w: 60, h: 77 },
 { x: 1079, y: 1538, w: 53, h: 81 },
 { x: 11, y: 1540, w: 55, h: 83 },
 { x: 335, y: 1541, w: 61, h: 79 },
 { x: 979, y: 1541, w: 56, h: 80 },
 { x: 411, y: 1574, w: 56, h: 56 },
 { x: 531, y: 1580, w: 62, h: 121 },
 { x: 732, y: 1589, w: 59, h: 127 },
 { x: 226, y: 1593, w: 44, h: 136 },
 { x: 840, y: 1600, w: 53, h: 64 },
 { x: 912, y: 1602, w: 46, h: 62 },
 { x: 1316, y: 1603, w: 43, h: 69 },
 { x: 1248, y: 1606, w: 53, h: 72 },
 { x: 1176, y: 1615, w: 57, h: 149 },
 { x: 126, y: 1616, w: 60, h: 77 },
 { x: 631, y: 1616, w: 63, h: 152 },
 { x: 336, y: 1626, w: 58, h: 82 },
 { x: 1079, y: 1624, w: 53, h: 81 },
 { x: 11, y: 1628, w: 54, h: 83 },
 { x: 978, y: 1629, w: 58, h: 80 },
 { x: 413, y: 1635, w: 52, h: 56 },
 { x: 840, y: 1672, w: 50, h: 66 },
 { x: 910, y: 1674, w: 53, h: 63 },
 { x: 1317, y: 1677, w: 41, h: 70 },
 { x: 1251, y: 1685, w: 47, h: 69 },
 { x: 125, y: 1698, w: 63, h: 76 },
 { x: 530, y: 1706, w: 64, h: 122 },
 { x: 1079, y: 1710, w: 53, h: 81 },
 { x: 336, y: 1713, w: 58, h: 82 },
 { x: 10, y: 1718, w: 56, h: 79 },
 { x: 979, y: 1716, w: 56, h: 83 },
 { x: 731, y: 1722, w: 60, h: 130 },
 { x: 225, y: 1736, w: 46, h: 133 },
 { x: 1176, y: 1772, w: 57, h: 155 },
 { x: 630, y: 1776, w: 64, h: 157 },
 { x: 531, y: 1834, w: 62, h: 121 },
 { x: 732, y: 1859, w: 59, h: 127 },
 { x: 225, y: 1877, w: 46, h: 133 },
 { x: 1176, y: 1935, w: 57, h: 149 },
 { x: 631, y: 1940, w: 63, h: 152 },
];

export const WILD_BUSHES: SpriteBox[] = [
  { x: 1, y: 7, w: 30, h: 41 },
  { x: 33, y: 7, w: 30, h: 41 },
  { x: 64, y: 7, w: 64, h: 41 },
  { x: 1, y: 58, w: 30, h: 35 },
  { x: 33, y: 58, w: 30, h: 35 },
  { x: 65, y: 58, w: 30, h: 35 },
  { x: 0, y: 98, w: 31, h: 29 },
  { x: 32, y: 98, w: 31, h: 29 },
  { x: 64, y: 98, w: 31, h: 29 },
  { x: 96, y: 98, w: 31, h: 29 },
  { x: 1, y: 132, w: 46, h: 43 },
  { x: 49, y: 132, w: 46, h: 43 },
  { x: 1, y: 177, w: 46, h: 46 },
  { x: 51, y: 177, w: 44, h: 46 },
  { x: 0, y: 229, w: 128, h: 27 },
  { x: 3, y: 261, w: 10, h: 25 },
  { x: 18, y: 261, w: 13, h: 25 },
  { x: 32, y: 261, w: 15, h: 25 },
  { x: 48, y: 261, w: 15, h: 25 },
  { x: 67, y: 261, w: 10, h: 25 },
  { x: 82, y: 261, w: 13, h: 25 },
  { x: 96, y: 261, w: 15, h: 25 },
  { x: 112, y: 261, w: 15, h: 25 },
  { x: 3, y: 293, w: 10, h: 25 },
  { x: 18, y: 293, w: 13, h: 25 },
  { x: 32, y: 293, w: 15, h: 25 },
  { x: 48, y: 293, w: 15, h: 25 },
  { x: 68, y: 293, w: 9, h: 25 },
  { x: 83, y: 293, w: 11, h: 25 },
  { x: 98, y: 293, w: 12, h: 25 },
  { x: 114, y: 293, w: 12, h: 25 },
  { x: 0, y: 320, w: 60, h: 32 },
];

/** Flat water cell from the bush sheet, stamped over the pond bed. */
export const WILD_WATER: SpriteBox = { x: 60, y: 320, w: 68, h: 32 };

/** Per-lot stamp factory: unique clip ids, source-over occluding stamps. */
export function stamper(lotIndex: number): StampFn {
  let n = 0;
  return (file, sheet, box, anchorX, anchorY, targetW, dimmed) => {
    const p = propPlacement(sheet, box, anchorX, anchorY, targetW);
    const id = `clip-lot-${lotIndex}-${n++}`;
    const dim = dimmed ? ' opacity="0.62"' : "";
    return (
      `<clipPath id="${id}"><rect x="${fmt(p.clipX)}" y="${fmt(p.clipY)}" width="${fmt(p.clipW)}" height="${fmt(p.clipH)}"/></clipPath>` +
      `<image href="/assets/sprites/${file}" x="${fmt(p.imgX)}" y="${fmt(p.imgY)}" width="${fmt(p.imgW)}" height="${fmt(p.imgH)}" preserveAspectRatio="none" clip-path="url(#${id})"${dim}/>`
    );
  };
}
