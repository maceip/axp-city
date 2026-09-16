import type { BuildingBand } from "../types.js";

/**
 * Measured frames from the existing keyed sheets, excluding printed ID labels.
 * Each frame belongs to one catalog cell. Medium/large first rows begin above
 * y=62; the old bounds clipped roofs and joined neighboring cells 47/48.
 * Texture bytes are unchanged. The renderer caps both width and height.
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

/** Restyled 2026-09-16 catalog: ChatGPT AXP families on a 5-column grid + original pagoda. */
export const BUILDING_SPRITES: Record<number, SpriteBox> = {
  1: { x: 78, y: 65, w: 99, h: 111 },
  2: { x: 329, y: 56, w: 110, h: 120 },
  3: { x: 579, y: 61, w: 121, h: 115 },
  4: { x: 831, y: 52, w: 129, h: 124 },
  5: { x: 1087, y: 55, w: 129, h: 121 },
  6: { x: 63, y: 244, w: 130, h: 112 },
  7: { x: 322, y: 237, w: 123, h: 119 },
  8: { x: 579, y: 253, w: 122, h: 103 },
  9: { x: 837, y: 238, w: 117, h: 118 },
  10: { x: 1094, y: 239, w: 115, h: 117 },
  11: { x: 22, y: 364, w: 211, h: 172 },
  12: { x: 283, y: 364, w: 202, h: 172 },
  13: { x: 546, y: 364, w: 187, h: 172 },
  14: { x: 806, y: 364, w: 179, h: 172 },
  15: { x: 1053, y: 364, w: 198, h: 172 },
  16: { x: 20, y: 544, w: 215, h: 172 },
  17: { x: 298, y: 545, w: 171, h: 171 },
  18: { x: 82, y: 4, w: 91, h: 172 },
  19: { x: 333, y: 4, w: 101, h: 172 },
  20: { x: 584, y: 4, w: 111, h: 172 },
  21: { x: 834, y: 4, w: 124, h: 172 },
  22: { x: 1094, y: 4, w: 115, h: 172 },
  23: { x: 65, y: 184, w: 126, h: 172 },
  24: { x: 325, y: 184, w: 118, h: 172 },
  25: { x: 573, y: 184, w: 134, h: 172 },
  26: { x: 839, y: 184, w: 114, h: 172 },
  27: { x: 1097, y: 184, w: 109, h: 172 },
  28: { x: 35, y: 364, w: 186, h: 172 },
  29: { x: 297, y: 364, w: 174, h: 172 },
  30: { x: 550, y: 364, w: 179, h: 172 },
  31: { x: 815, y: 364, w: 162, h: 172 },
  32: { x: 1062, y: 364, w: 180, h: 172 },
  33: { x: 41, y: 544, w: 173, h: 172 },
  34: { x: 279, y: 544, w: 210, h: 172 },
  35: { x: 129, y: 5, w: 61, h: 171 },
  36: { x: 448, y: 4, w: 64, h: 172 },
  37: { x: 765, y: 4, w: 70, h: 172 },
  38: { x: 1082, y: 4, w: 75, h: 172 },
  39: { x: 122, y: 184, w: 76, h: 172 },
  40: { x: 440, y: 184, w: 80, h: 172 },
  41: { x: 765, y: 184, w: 70, h: 172 },
  42: { x: 1079, y: 184, w: 82, h: 172 },
  43: { x: 127, y: 364, w: 66, h: 172 },
  44: { x: 448, y: 364, w: 63, h: 172 },
  45: { x: 718, y: 364, w: 163, h: 172 },
  46: { x: 1042, y: 364, w: 155, h: 172 },
  47: { x: 82, y: 544, w: 156, h: 172 },
  48: { x: 406, y: 544, w: 148, h: 172 },
  49: { x: 719, y: 544, w: 161, h: 172 },
  50: { x: 1045, y: 544, w: 149, h: 172 },
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
export const CREW_WALK = [
  "walk1",
  "walk2",
  "walk3",
  "walkOlive1",
  "walkOlive2",
].map(propBox);
export const CREW_CARRY = ["carryWhite", "carryOlive", "cart"].map(propBox);
export const DRONE_QUADS = ["quadScout", "quadTeal", "quadCarry", "quadA"].map(
  propBox,
);

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

/** Restyled civic atlas: center office, construction stages, plants, roads, odd unused civic footprints. */
export const CIVIC_SHEET: PropSheet = {
  file: "civic-kit-k1.png",
  width: 1536,
  height: 1024,
};

export const CIVIC_SPRITES: Record<string, SpriteBox> = {
  office: { x: 8, y: 8, w: 420, h: 303 },
  "city-hall": { x: 436, y: 8, w: 144, h: 125 },
  "bank-office": { x: 1035, y: 8, w: 99, h: 114 },
  "scaffold-0": { x: 1142, y: 8, w: 87, h: 73 },
  "scaffold-1": { x: 1237, y: 8, w: 75, h: 99 },
  "scaffold-2": { x: 1320, y: 8, w: 88, h: 110 },
  "scaffold-3": { x: 1416, y: 8, w: 95, h: 110 },
  parking: { x: 86, y: 319, w: 174, h: 180 },
  "plant-0": { x: 1375, y: 319, w: 74, h: 101 },
  "plant-1": { x: 8, y: 507, w: 73, h: 101 },
  "plant-2": { x: 89, y: 507, w: 61, h: 107 },
  "plant-3": { x: 158, y: 507, w: 57, h: 105 },
  "plant-5": { x: 223, y: 507, w: 90, h: 65 },
  "road-0": { x: 8, y: 640, w: 146, h: 96 },
  "road-1": { x: 162, y: 640, w: 144, h: 97 },
  "bike-0": { x: 320, y: 640, w: 120, h: 70 },
  "bike-1": { x: 448, y: 640, w: 120, h: 70 },
  "odd-2": { x: 588, y: 8, w: 171, h: 202 },
  "odd-3": { x: 767, y: 8, w: 144, h: 139 },
  "odd-4": { x: 919, y: 8, w: 108, h: 122 },
  "odd-6": { x: 1208, y: 319, w: 159, h: 157 },
  "gate-0": { x: 268, y: 319, w: 156, h: 65 },
  "gate-1": { x: 432, y: 319, w: 156, h: 68 },
  "gate-2": { x: 596, y: 319, w: 145, h: 68 },
  "gate-3": { x: 749, y: 319, w: 145, h: 68 },
  "gate-4": { x: 902, y: 319, w: 145, h: 68 },
  "gate-5": { x: 1055, y: 319, w: 145, h: 50 },
};

/** On-screen width of the park-center HQ compound — larger than any repo lot. */
export const OFFICE_STAMP_WIDTH = 480;

/** Unused inland civics. Fence/gates use the flyover width; home zoom lerps down. */
export const ODD_STAMP_WIDTH: Record<string, number> = {
  "odd-2": 228,
  "odd-3": 138,
  "odd-4": 210,
  "odd-6": 160,
  "city-hall": 132,
  "bank-office": 120,
};

/** Lot-adjacent home-zoom sizes so fence/gates do not swallow the street. */
export const ODD_HOME_WIDTH: Record<string, number> = {
  "odd-2": 132,
  "odd-3": 138,
  "odd-4": 124,
  "odd-6": 148,
  "city-hall": 118,
  "bank-office": 120,
};

/** Zoom at/above this uses ODD_HOME_WIDTH; two zoom-outs (~0.69) reach ODD_STAMP_WIDTH. */
export const ODD_FLYOVER_ZOOM = 0.69;

export function oddDisplayWidth(sprite: string, zoom: number): number {
  const fly = ODD_STAMP_WIDTH[sprite] ?? 160;
  const home = ODD_HOME_WIDTH[sprite] ?? fly;
  if (home >= fly) return fly;
  const t = Math.min(1, Math.max(0, (1 - zoom) / (1 - ODD_FLYOVER_ZOOM)));
  return home + (fly - home) * t;
}

/** Street / bike-lane stamps — sized to read at overview and home zoom. */
export const ROAD_STAMP_WIDTH = 176;
export const BIKE_STAMP_WIDTH = 220;

export const CONSTRUCTION_STAGES: Record<string, SpriteBox> = {
  grading: CIVIC_SPRITES["scaffold-0"],
  framing: CIVIC_SPRITES["scaffold-1"],
  cladding: CIVIC_SPRITES["scaffold-2"],
  finishing: CIVIC_SPRITES["scaffold-3"],
};

export const CIVIC_PLANTS = [
  CIVIC_SPRITES["plant-0"],
  CIVIC_SPRITES["plant-1"],
  CIVIC_SPRITES["plant-2"],
  CIVIC_SPRITES["plant-3"],
  CIVIC_SPRITES["plant-5"],
];

export const CIVIC_ODD = [
  CIVIC_SPRITES["odd-2"],
  CIVIC_SPRITES["odd-3"],
  CIVIC_SPRITES["odd-4"],
  CIVIC_SPRITES["odd-6"],
  CIVIC_SPRITES["bank-office"],
  CIVIC_SPRITES["city-hall"],
];

/** Construction-city HUD: beveled wood/slate plaques with brass rivets. */
export const HUD_SHEET: PropSheet = {
  file: "hud-kit-k1.png",
  width: 1024,
  height: 768,
};

/** PIL-baked JetBrains Mono atlas — Phaser Text/fillText doubles glyphs on SwiftShader. */
export const HUD_FONT = {
  file: "hud-font-k1.png",
  xml: "hud-font-k1.xml",
  width: 400,
  height: 494,
  face: "hud-ink",
};

export const HUD_FRAMES: Record<string, SpriteBox> = {
  plate: { x: 8, y: 8, w: 250, h: 78 },
  status: { x: 270, y: 8, w: 320, h: 62 },
  mass: { x: 600, y: 8, w: 186, h: 44 },
  card: { x: 8, y: 100, w: 330, h: 260 },
  census: { x: 8, y: 380, w: 900, h: 120 },
  minimap: { x: 350, y: 100, w: 200, h: 140 },
  toast: { x: 8, y: 520, w: 360, h: 48 },
  btn: { x: 580, y: 100, w: 92, h: 36 },
  "btn-wide": { x: 580, y: 148, w: 140, h: 36 },
  "btn-sq": { x: 580, y: 196, w: 46, h: 46 },
  dpad: { x: 740, y: 100, w: 150, h: 150 },
  compass: { x: 910, y: 8, w: 100, h: 100 },
  rail: { x: 740, y: 260, w: 130, h: 220 },
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
export const DECOR_TREES = ["treeRoundA", "pineA", "treeRoundB", "pineB"].map(
  groundBox,
);
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
