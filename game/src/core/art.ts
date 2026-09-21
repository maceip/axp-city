import Phaser from "phaser";

/** Every dimension below is in logical pixels or whole map cells, never camera zoom. */
export const TILE_W = 72;
export const TILE_H = 36;
export const ART_VERSION = 1;
const RESOLUTION = 2;
export type CoreBuildingKind = "cottage" | "shop" | "workshop";
export type CoreHeading = "n" | "e" | "s" | "w";
type Point = { x: number; y: number };

export function coreProject(x: number, y: number, z = 0): Point {
  return { x: ((x - y) * TILE_W) / 2, y: ((x + y) * TILE_H) / 2 - z };
}
export function coreUnproject(sx: number, sy: number): Point {
  return { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W };
}

export interface TerrainPaint {
  x: number;
  y: number;
  terrain: "grass" | "dirt" | "water";
  road: boolean;
  /** N=1, E=2, S=4, W=8. A bit means a compatible cardinal neighbor. */
  roadMask: number;
  waterMask: number;
  elevation?: number;
  variant?: number;
}

const GRASS = [0x8fa779, 0x91a97b, 0x8ea578, 0x93aa7e, 0x90a67b];
const EARTH = [0xc7b58f, 0xc4b28b, 0xc8b791, 0xc3b18d];
const WATER = [0x719eac, 0x739fac, 0x719dab, 0x759fac];
const CARDINALS = [
  { bit: 1, dx: 0, dy: -1 },
  { bit: 2, dx: 1, dy: 0 },
  { bit: 4, dx: 0, dy: 1 },
  { bit: 8, dx: -1, dy: 0 },
] as const;

function hash(x: number, y: number, salt = 0): number {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ salt;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** A single terrain paint path for every mask, including endpoints and isolated cells.
 * The caller may bake these into chunks. It must offset the Graphics object, not
 * alter world coordinates, so cell variants stay identical across chunk borders.
 */
export function drawTerrain(
  g: Phaser.GameObjects.Graphics,
  cell: TerrainPaint,
): void {
  const { x, y, terrain, road, roadMask, waterMask } = cell;
  const z = cell.elevation ?? 0;
  const seed = cell.variant ?? Math.floor(hash(x, y, 831) * 65536);
  const polygon = (
    points: Array<[number, number]>,
    color: number,
    alpha = 1,
  ) => {
    g.fillStyle(color, alpha);
    g.fillPoints(
      points.map(([u, v]) => {
        const p = coreProject(x + u, y + v, z);
        return new Phaser.Math.Vector2(p.x, p.y);
      }),
      true,
    );
  };
  const rect = (
    u: number,
    v: number,
    w: number,
    d: number,
    color: number,
    alpha = 1,
  ) =>
    polygon(
      [
        [u, v],
        [u + w, v],
        [u + w, v + d],
        [u, v + d],
      ],
      color,
      alpha,
    );
  const colors =
    terrain === "water" ? WATER : terrain === "dirt" ? EARTH : GRASS;
  rect(0, 0, 1, 1, colors[Math.abs(seed) % colors.length]);

  if (terrain === "water") {
    // Shore bands occupy only the water side of a boundary. Shared water edges
    // remain untouched, so all 16 masks join without outlines or floating tiles.
    for (const side of CARDINALS) {
      if (waterMask & side.bit) continue;
      if (side.bit === 1) {
        rect(0, 0, 1, 0.105, 0xc9c19b);
        rect(0, 0.105, 1, 0.06, 0x94b3ad);
      }
      if (side.bit === 2) {
        rect(0.895, 0, 0.105, 1, 0xc9c19b);
        rect(0.835, 0, 0.06, 1, 0x94b3ad);
      }
      if (side.bit === 4) {
        rect(0, 0.895, 1, 0.105, 0xc9c19b);
        rect(0, 0.835, 1, 0.06, 0x94b3ad);
      }
      if (side.bit === 8) {
        rect(0, 0, 0.105, 1, 0xc9c19b);
        rect(0.105, 0, 0.06, 1, 0x94b3ad);
      }
    }
    if (seed % 4 === 0) {
      const a = coreProject(x + 0.36, y + 0.4, z);
      const b = coreProject(x + 0.61, y + 0.4, z);
      g.lineStyle(1, 0xc5dce0, 0.4).lineBetween(a.x, a.y, b.x, b.y);
    }
    return;
  }

  if (road) {
    // Draw the shared center and arms as one visual material. The wider lower
    // pass is the verge/curb; lane paint follows exactly the same connectivity.
    const network = (width: number, color: number) => {
      const a = (1 - width) / 2;
      rect(a, a, width, width, color);
      if (roadMask & 1) rect(a, 0, width, 0.5, color);
      if (roadMask & 2) rect(0.5, a, 0.5, width, color);
      if (roadMask & 4) rect(a, 0.5, width, 0.5, color);
      if (roadMask & 8) rect(0, a, 0.5, width, color);
    };
    network(0.88, 0x7d8c74);
    network(0.8, 0xc1c5b4);
    network(0.65, 0x74817d);
    network(0.59, 0x7b8883);
    for (const side of CARDINALS) {
      if (!(roadMask & side.bit)) continue;
      const a = coreProject(
        x + 0.5 + side.dx * 0.23,
        y + 0.5 + side.dy * 0.23,
        z,
      );
      const b = coreProject(
        x + 0.5 + side.dx * 0.43,
        y + 0.5 + side.dy * 0.43,
        z,
      );
      g.lineStyle(1.35, 0xe4dfc4, 0.85).lineBetween(a.x, a.y, b.x, b.y);
    }
    return;
  }

  // Sparse, quiet texture; deterministic at any viewport or chunk coordinate.
  if (terrain === "grass" && seed % 3 === 0) {
    const p = coreProject(
      x + 0.27 + hash(x, y, 92) * 0.42,
      y + 0.25 + hash(x, y, 23) * 0.42,
      z,
    );
    g.lineStyle(0.8, 0x607d53, 0.2).lineBetween(p.x, p.y, p.x + 2.5, p.y - 1.5);
    g.lineBetween(p.x + 3, p.y + 1, p.x + 4.5, p.y - 0.5);
  } else if (terrain === "dirt" && seed % 2 === 0) {
    const p = coreProject(x + 0.35, y + 0.65, z);
    g.fillStyle(0x9d8d70, 0.24).fillEllipse(p.x, p.y, 2.8, 1.2);
  }
}

export interface CoreSpriteSpec {
  texture: string;
  worldFootprint: { w: number; d: number };
  /** Fractional texture anchor; independent of transparent margins. */
  originX: number;
  originY: number;
  /** Logical display dimensions. Texture pixels are 2× these dimensions. */
  width: number;
  height: number;
  /** World offset from the entity's northwest footprint cell. */
  anchor: { x: number; y: number };
}

interface BuildingArt extends CoreSpriteSpec {
  offset: Point;
}
function buildingSpec(
  kind: CoreBuildingKind,
  w: number,
  d: number,
  rise: number,
): BuildingArt {
  const padding = 25;
  const width = ((w + d) * TILE_W) / 2 + padding * 2;
  const height = ((w + d) * TILE_H) / 2 + rise + padding * 2;
  const offset = { x: (d * TILE_W) / 2 + padding, y: rise + padding };
  const front = coreProject(w, d);
  return {
    texture: `core-${kind}-v${ART_VERSION}`,
    worldFootprint: { w, d },
    width,
    height,
    originX: (offset.x + front.x) / width,
    originY: (offset.y + front.y) / height,
    anchor: { x: w, y: d },
    offset,
  };
}
const BUILDING_ART: Record<CoreBuildingKind, BuildingArt> = {
  cottage: buildingSpec("cottage", 2, 2, 98),
  shop: buildingSpec("shop", 3, 2, 95),
  workshop: buildingSpec("workshop", 3, 3, 108),
};
export function buildingSpriteSpec(kind: CoreBuildingKind): CoreSpriteSpec {
  return BUILDING_ART[kind];
}
const TREE: CoreSpriteSpec = {
  texture: `core-tree-v${ART_VERSION}`,
  worldFootprint: { w: 1, d: 1 },
  width: 96,
  height: 122,
  originX: 0.5,
  originY: 108 / 122,
  anchor: { x: 0.5, y: 0.5 },
};
export function treeSpriteSpec(): CoreSpriteSpec {
  return TREE;
}
export function vehicleSpriteSpec(heading: CoreHeading): CoreSpriteSpec {
  const alongX = heading === "e" || heading === "w";
  return {
    texture: `core-car-${heading}-v${ART_VERSION}`,
    worldFootprint: { w: alongX ? 0.69 : 0.36, d: alongX ? 0.36 : 0.69 },
    width: 66,
    height: 58,
    originX: 0.5,
    originY: 42 / 58,
    anchor: { x: 0, y: 0 },
  };
}

type Ctx = CanvasRenderingContext2D;
function poly(ctx: Ctx, pts: Point[], fill: string, stroke?: string): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.65;
    ctx.stroke();
  }
}
function line(ctx: Ctx, a: Point, b: Point, color: string, width = 1): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function ellipse(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
function ground(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  d: number,
  fill: string,
  z = 0,
): void {
  poly(
    ctx,
    [
      coreProject(x, y, z),
      coreProject(x + w, y, z),
      coreProject(x + w, y + d, z),
      coreProject(x, y + d, z),
    ],
    fill,
  );
}
function prism(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  d: number,
  z: number,
  h: number,
  top: string,
  light: string,
  dark: string,
): void {
  const p = (u: number, v: number, k: number) => coreProject(u, v, k);
  poly(
    ctx,
    [
      p(x, y + d, z),
      p(x + w, y + d, z),
      p(x + w, y + d, z + h),
      p(x, y + d, z + h),
    ],
    light,
    "rgba(63,65,50,.18)",
  );
  poly(
    ctx,
    [
      p(x + w, y, z),
      p(x + w, y + d, z),
      p(x + w, y + d, z + h),
      p(x + w, y, z + h),
    ],
    dark,
    "rgba(63,65,50,.18)",
  );
  poly(
    ctx,
    [
      p(x, y, z + h),
      p(x + w, y, z + h),
      p(x + w, y + d, z + h),
      p(x, y + d, z + h),
    ],
    top,
    "rgba(63,65,50,.18)",
  );
}
function face(
  ctx: Ctx,
  side: "south" | "east",
  edge: number,
  start: number,
  span: number,
  bottom: number,
  height: number,
  fill: string,
  stroke?: string,
): void {
  const p = (s: number, z: number) =>
    side === "south" ? coreProject(s, edge, z) : coreProject(edge, s, z);
  poly(
    ctx,
    [
      p(start, bottom),
      p(start + span, bottom),
      p(start + span, bottom + height),
      p(start, bottom + height),
    ],
    fill,
    stroke,
  );
}
function windowOn(
  ctx: Ctx,
  side: "south" | "east",
  edge: number,
  at: number,
  width = 0.35,
  bottom = 20,
  height = 19,
): void {
  face(
    ctx,
    side,
    edge,
    at - 0.045,
    width + 0.09,
    bottom - 2,
    height + 4,
    "#e9dfbd",
  );
  face(
    ctx,
    side,
    edge + 0.006,
    at,
    width,
    bottom,
    height,
    side === "south" ? "#6d8c8b" : "#577473",
  );
  face(
    ctx,
    side,
    edge + 0.009,
    at + width * 0.08,
    width * 0.37,
    bottom + height * 0.53,
    height * 0.34,
    "#aec8bd",
  );
  const p = (s: number, z: number) =>
    side === "south"
      ? coreProject(s, edge + 0.015, z)
      : coreProject(edge + 0.015, s, z);
  line(
    ctx,
    p(at + width / 2, bottom),
    p(at + width / 2, bottom + height),
    "#dcd5b6",
    1.1,
  );
  line(
    ctx,
    p(at, bottom + height * 0.45),
    p(at + width, bottom + height * 0.45),
    "#dcd5b6",
    1,
  );
  line(
    ctx,
    p(at - 0.06, bottom - 2),
    p(at + width + 0.06, bottom - 2),
    "#b6ac8e",
    2,
  );
}
function gable(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  d: number,
  z: number,
  rise: number,
  roof: string,
  roofDark: string,
): void {
  const p = coreProject;
  poly(
    ctx,
    [p(x, y + d, z), p(x + w, y + d, z), p(x + w / 2, y + d, z + rise)],
    "#dfcba2",
  );
  const e = 0.11;
  poly(
    ctx,
    [
      p(x - e, y - e, z),
      p(x + w / 2, y - e, z + rise),
      p(x + w / 2, y + d + e, z + rise),
      p(x - e, y + d + e, z),
    ],
    roof,
    "#745f4d",
  );
  poly(
    ctx,
    [
      p(x + w / 2, y - e, z + rise),
      p(x + w + e, y - e, z),
      p(x + w + e, y + d + e, z),
      p(x + w / 2, y + d + e, z + rise),
    ],
    roofDark,
    "#745f4d",
  );
  line(
    ctx,
    p(x + w / 2, y - e, z + rise + 1),
    p(x + w / 2, y + d + e, z + rise + 1),
    "#d6a181",
    2.3,
  );
  // Quiet courses give the roof scale without thousands of individual shingles.
  for (let j = 1; j < 5; j++) {
    const t = j / 5;
    line(
      ctx,
      p(x - e + (w / 2 + e) * t, y - e, z + rise * t),
      p(x - e + (w / 2 + e) * t, y + d + e, z + rise * t),
      "rgba(91,60,45,.17)",
      0.8,
    );
    line(
      ctx,
      p(x + w / 2 + (w / 2 + e) * t, y - e, z + rise * (1 - t)),
      p(x + w / 2 + (w / 2 + e) * t, y + d + e, z + rise * (1 - t)),
      "rgba(64,52,42,.18)",
      0.8,
    );
  }
}
function shrub(ctx: Ctx, x: number, y: number, size = 10): void {
  const p = coreProject(x, y, 5);
  ellipse(
    ctx,
    p.x + 2,
    p.y + 3,
    size * 0.95,
    size * 0.38,
    "rgba(47,65,42,.12)",
  );
  ellipse(ctx, p.x, p.y - 3, size, size * 0.7, "#557951");
  ellipse(ctx, p.x - 2, p.y - 5, size * 0.7, size * 0.52, "#789552");
}
function planter(ctx: Ctx, x: number, y: number, w = 0.35, d = 0.3): void {
  prism(ctx, x, y, w, d, 1, 6, "#bc9a70", "#bc9871", "#a07e58");
  shrub(ctx, x + w / 2, y + d / 2, 7);
}

function drawBuilding(ctx: Ctx, kind: CoreBuildingKind): void {
  const spec = BUILDING_ART[kind],
    { w, d } = spec.worldFootprint;
  ctx.translate(spec.offset.x, spec.offset.y);
  // All shadows point southeast on screen; baked art never changes with zoom.
  poly(
    ctx,
    [
      coreProject(0.14, 0.14),
      coreProject(w - 0.05, 0.14),
      coreProject(w + 0.37, d - 0.05),
      coreProject(0.6, d + 0.2),
    ],
    "rgba(45,64,46,.13)",
  );
  ground(ctx, 0.04, 0.04, w - 0.08, d - 0.08, "#a6ae8d");
  ground(ctx, 0.12, 0.12, w - 0.24, d - 0.24, "#c9c3a6");

  if (kind === "cottage") {
    const x = 0.25,
      y = 0.23,
      bw = 1.5,
      bd = 1.3;
    ground(ctx, 0.48, 1.48, 0.6, 0.45, "#e0d3b3");
    prism(ctx, x, y, bw, bd, 0, 5, "#c0b598", "#a99d80", "#968d74");
    prism(ctx, x, y, bw, bd, 5, 46, "#e9d6b0", "#e9d8b5", "#d2bd97");
    face(ctx, "south", y + bd + 0.01, 0.62, 0.42, 5, 31, "#756e53");
    face(ctx, "south", y + bd + 0.02, 0.66, 0.32, 21, 10, "#9bb5a8");
    const knob = coreProject(0.96, y + bd + 0.04, 18);
    ellipse(ctx, knob.x, knob.y, 1.1, 1.1, "#d4ba72");
    windowOn(ctx, "south", y + bd + 0.01, 1.23, 0.32, 22, 17);
    windowOn(ctx, "east", x + bw + 0.01, 0.53, 0.35, 23, 19);
    gable(ctx, x, y, bw, bd, 54, 26, "#b97859", "#935d49");
    prism(ctx, 0.38, 0.4, 0.22, 0.24, 62, 23, "#bcaa90", "#a78c70", "#8c735d");
    prism(ctx, 0.34, 0.36, 0.3, 0.32, 83, 4, "#cdbb98", "#aa9275", "#947d66");
    planter(ctx, 1.49, 1.58, 0.3, 0.25);
    shrub(ctx, 0.24, 1.72, 9);
    // A small gate-free garden retains clear access to the south entry cell.
    ground(ctx, 1.65, 1.7, 0.2, 0.12, "#b6aa86");
  } else if (kind === "shop") {
    const x = 0.22,
      y = 0.23,
      bw = 2.55,
      bd = 1.36;
    ground(ctx, 0.28, 1.52, 2.43, 0.36, "#dfd1b0");
    prism(ctx, x, y, bw, bd, 0, 5, "#c3b493", "#b0a183", "#9b8e74");
    prism(ctx, x, y, bw, bd, 5, 49, "#eadabd", "#eadcba", "#d0c0a0");
    face(ctx, "south", y + bd + 0.012, 0.39, 0.7, 9, 27, "#6b8983", "#cfbd95");
    face(ctx, "south", y + bd + 0.012, 1.86, 0.7, 9, 27, "#6b8983", "#cfbd95");
    for (const sx of [0.4, 1.87])
      face(ctx, "south", y + bd + 0.018, sx + 0.08, 0.18, 26, 8, "#adc4b3");
    face(ctx, "south", y + bd + 0.015, 1.29, 0.37, 5, 35, "#677569");
    face(ctx, "south", y + bd + 0.02, 1.34, 0.26, 20, 16, "#adc2b3");
    windowOn(ctx, "east", x + bw + 0.01, 0.59, 0.38, 24, 20);
    // A striped cloth awning is a structural attachment with one host depth.
    const ay = y + bd + 0.36;
    for (let i = 0; i < 10; i++) {
      const sx = 0.28 + i * 0.243;
      poly(
        ctx,
        [
          coreProject(sx, y + bd, 43),
          coreProject(sx + 0.243, y + bd, 43),
          coreProject(sx + 0.243, ay, 35),
          coreProject(sx, ay, 35),
        ],
        i % 2 ? "#e6dabb" : "#7d9477",
      );
      face(ctx, "south", ay, sx, 0.243, 31, 4, i % 2 ? "#d9cba8" : "#657f64");
    }
    gable(ctx, x, y, bw, bd, 57, 23, "#71827f", "#546d70");
    // Unlettered enamel sign: a legible shop silhouette without tiny fake text.
    face(ctx, "south", y + bd + 0.015, 1.1, 0.77, 48, 9, "#728777", "#f2e5c2");
    for (const sx of [1.26, 1.4, 1.54]) {
      const p = coreProject(sx, y + bd + 0.03, 52);
      ellipse(ctx, p.x, p.y, 1.5, 1.5, "#e7d9b0");
    }
    planter(ctx, 0.14, 1.68, 0.32, 0.22);
    planter(ctx, 2.55, 1.67, 0.29, 0.22);
  } else {
    const x = 0.22,
      y = 0.26,
      bw = 2.53,
      bd = 2.29;
    ground(ctx, 0.35, 2.45, 2.35, 0.42, "#b5b19b");
    prism(ctx, x, y, bw, bd, 0, 7, "#aaa28a", "#a49b82", "#888670");
    prism(ctx, x, y, bw, bd, 7, 46, "#dfc9a3", "#dbc49b", "#c3aa83");
    // Wide timber loading door and glazed strip keep the workshop identifiable.
    face(ctx, "south", y + bd + 0.012, 0.97, 0.95, 7, 32, "#8c8c78", "#a49574");
    for (let j = 1; j < 6; j++) {
      const z = 7 + j * 5;
      line(
        ctx,
        coreProject(0.98, y + bd + 0.02, z),
        coreProject(1.91, y + bd + 0.02, z),
        "#6b7467",
        0.75,
      );
    }
    face(ctx, "south", y + bd + 0.02, 0.99, 0.91, 32, 6, "#96b4ae");
    face(ctx, "south", y + bd + 0.015, 0.42, 0.34, 7, 28, "#6e796a");
    for (const s of [0.62, 1.25, 1.88])
      windowOn(ctx, "east", x + bw + 0.01, s, 0.34, 27, 17);
    gable(ctx, x, y, bw, bd, 57, 24, "#879895", "#617b7b");
    // Roof lantern follows the same projected grid, not screen-space guesses.
    prism(ctx, 0.96, 0.71, 0.64, 1.27, 69, 12, "#77939a", "#b3c9c2", "#83a4a3");
    prism(ctx, 0.92, 0.67, 0.72, 1.35, 81, 3, "#586f70", "#718583", "#4f696b");
    prism(ctx, 2.18, 0.42, 0.31, 0.35, 55, 40, "#bdad91", "#af9878", "#8c7c66");
    prism(ctx, 2.13, 0.37, 0.41, 0.45, 93, 5, "#cebea1", "#ae977b", "#96816a");
    prism(ctx, 2.25, 2.6, 0.32, 0.23, 0, 11, "#b8a077", "#a58963", "#8e775a");
    prism(ctx, 2.34, 2.38, 0.29, 0.22, 0, 10, "#c1ab82", "#ae936d", "#947b59");
    planter(ctx, 0.14, 2.64, 0.35, 0.24);
  }
}

function drawTree(ctx: Ctx): void {
  ellipse(ctx, 53, 108, 23, 9, "rgba(45,67,40,.17)");
  poly(
    ctx,
    [
      { x: 45, y: 109 },
      { x: 51, y: 109 },
      { x: 51, y: 65 },
      { x: 45, y: 67 },
    ],
    "#867459",
  );
  poly(
    ctx,
    [
      { x: 45, y: 104 },
      { x: 48, y: 104 },
      { x: 48, y: 69 },
      { x: 45, y: 71 },
    ],
    "#aa9470",
  );
  line(ctx, { x: 49, y: 86 }, { x: 65, y: 66 }, "#7d7052", 3);
  line(ctx, { x: 47, y: 80 }, { x: 32, y: 65 }, "#988360", 3);
  const crown = (
    x: number,
    y: number,
    r: number,
    color: string,
    salt: number,
  ) => {
    const pts = Array.from({ length: 11 }, (_, i) => {
      const a = (i / 11) * Math.PI * 2;
      const k = 0.91 + hash(i, salt, 71) * 0.16;
      return { x: x + Math.cos(a) * r * k, y: y + Math.sin(a) * r * 0.83 * k };
    });
    poly(ctx, pts, color);
  };
  crown(52, 68, 29, "#4e7456", 2);
  crown(34, 62, 23, "#668956", 3);
  crown(61, 48, 25, "#608451", 4);
  crown(43, 43, 28, "#789852", 5);
  crown(35, 36, 16, "#8eaa5c", 6);
  crown(58, 36, 14, "#809f55", 7);
  for (const [x, y] of [
    [28, 51],
    [47, 29],
    [61, 56],
    [40, 62],
  ])
    ellipse(ctx, x, y, 3.2, 2, "rgba(190,205,118,.2)");
}

function drawCar(ctx: Ctx, heading: CoreHeading): void {
  ctx.translate(33, 42);
  const alongX = heading === "e" || heading === "w";
  const w = alongX ? 0.69 : 0.36,
    d = alongX ? 0.36 : 0.69,
    x = -w / 2,
    y = -d / 2;
  const center = coreProject(0.06, 0.08);
  ellipse(ctx, center.x, center.y, 19, 7, "rgba(38,55,47,.23)");
  for (const [u, v] of [
    [x + 0.06, y + d],
    [x + w - 0.06, y + d],
    [x + w, y + 0.06],
    [x + w, y + d - 0.06],
  ]) {
    const p = coreProject(u, v, 2);
    ellipse(ctx, p.x, p.y, 3, 3.8, "#485450");
  }
  prism(ctx, x, y, w, d, 4, 8, "#d9b57c", "#c7a36a", "#aa875c");
  prism(
    ctx,
    x + w * 0.23,
    y + d * 0.23,
    w * 0.53,
    d * 0.53,
    12,
    7,
    "#d7c69b",
    "#abc4bd",
    "#7fa0a2",
  );
  const front =
    heading === "e"
      ? [x + w, y + d * 0.5]
      : heading === "w"
        ? [x, y + d * 0.5]
        : heading === "s"
          ? [x + w * 0.5, y + d]
          : [x + w * 0.5, y];
  const p = coreProject(front[0], front[1], 8);
  ellipse(ctx, p.x, p.y, 2.1, 1.3, "#f3e4bc");
}

function texture(
  scene: Phaser.Scene,
  spec: CoreSpriteSpec,
  paint: (ctx: Ctx) => void,
): void {
  if (scene.textures.exists(spec.texture)) return;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(spec.width * RESOLUTION);
  canvas.height = Math.ceil(spec.height * RESOLUTION);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The core city needs a Canvas 2D texture context.");
  ctx.scale(RESOLUTION, RESOLUTION);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  paint(ctx);
  scene.textures.addCanvas(spec.texture, canvas);
}

/** Called once at scene setup; texture keys survive pans and repeated scene setup. */
export function createCoreTextures(scene: Phaser.Scene): void {
  for (const kind of ["cottage", "shop", "workshop"] as const)
    texture(scene, BUILDING_ART[kind], (ctx) => drawBuilding(ctx, kind));
  texture(scene, TREE, drawTree);
  for (const heading of ["n", "e", "s", "w"] as const)
    texture(scene, vehicleSpriteSpec(heading), (ctx) => drawCar(ctx, heading));
}
