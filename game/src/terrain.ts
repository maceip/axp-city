import Phaser from "phaser";
import { project } from "../../src/render/iso.js";
import { hash01, type CityPlan, type CivicKind, tileKind } from "../../src/world/index.js";
import {
  BIKE_BAND,
  LOT_D,
  PARK_SX0,
  PARK_SX1,
  PARK_SY0,
  PARK_SY1,
  SHOULDER,
  STRIDE_X,
  STRIDE_Y,
} from "../../src/world/constants.js";
import { CHUNK_SIZE } from "../../src/game/visibility.js";
import {
  WILD_SHEETS,
  WILD_TREES,
  GROUND_SHEET,
  GROUND_TILES,
  DECOR_BENCH,
  DECOR_LAMP,
  CIVIC_SHEET,
  CIVIC_SPRITES,
  BIKE_STAMP_WIDTH,
  HUD_FONT,
  OFFICE_STAMP_WIDTH,
  ROAD_STAMP_WIDTH,
  oddDisplayWidth,
} from "../../src/render/sprites.js";
import { imagePool, type ObjectPool } from "./pool.js";
import { ensureFrame } from "./stamps.js";

const trees = WILD_TREES.filter((box) => box.h >= 50 && box.w < 130);
const COLORS: Record<string, number> = {
  park: 0x355028,
  freeway: 0x52606b,
  tram: 0x8f9890,
  river: 0x6a9094,
  lot: 0x8a9c72,
  vacant: 0x8ea070,
  street: 0x5e6662,
  bike: 0xa89c68,
  grass: 0x84966c,
  dirt: 0xb7ae80,
  water: 0x7a9a90,
  trees: 0x7d8f64,
};

interface ChunkView {
  key: string;
  ground: Phaser.GameObjects.Image;
  trees: Phaser.GameObjects.Image[];
}

/**
 * Ground is rasterised once per 8×8 chunk into a texture and cached in a
 * bounded LRU keyed by chunk and plan revision. Chunk images and trees are
 * pooled, so travelling across the map reuses objects and textures instead of
 * regenerating them every time a chunk crosses the viewport edge.
 */
export class TerrainCache {
  private textures = new Map<string, string>();
  private order: string[] = [];
  private views = new Map<string, ChunkView>();
  private images: ObjectPool<Phaser.GameObjects.Image>;
  private planId = 0;
  generated = 0;
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly capacity = 96,
  ) {
    this.images = imagePool(scene, 900);
  }

  /** A geometry change (features grew) invalidates cached ground. */
  invalidate(): void {
    this.planId++;
    for (const [key] of this.views) this.hide(key);
    for (const texture of this.textures.values()) this.scene.textures.remove(texture);
    this.textures.clear();
    this.order = [];
  }

  get visible(): number {
    return this.views.size;
  }
  get cached(): number {
    return this.textures.size;
  }

  sync(keys: Array<{ key: string; x: number; y: number }>, plan: CityPlan): void {
    const needed = new Set(keys.map((k) => k.key));
    for (const [key] of this.views) if (!needed.has(key)) this.hide(key);
    for (const chunk of keys) if (!this.views.has(chunk.key)) this.show(chunk, plan);
  }

  private hide(key: string): void {
    const view = this.views.get(key);
    if (!view) return;
    this.images.release(view.ground);
    for (const tree of view.trees) this.images.release(tree);
    this.views.delete(key);
  }

  private show(chunk: { key: string; x: number; y: number }, plan: CityPlan): void {
    const n = CHUNK_SIZE,
      width = n * 72,
      height = n * 36;
    const origin = project(chunk.x * n, chunk.y * n);
    const textureKey = this.texture(chunk, plan);
    const ground = this.images.acquire();
    ground
      .setTexture(textureKey)
      .setOrigin(0, 0)
      .setPosition(origin.sx - width / 2, origin.sy)
      .setDepth(-1_000_000);
    const treeImages: Phaser.GameObjects.Image[] = [];
    const park = plan.features.find((feature) => feature.kind === "park")!;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const wx = chunk.x * n + i,
          wy = chunk.y * n + j;
        const kind = tileKind(wx + 0.5, wy + 0.5, plan);
        const parkTree =
          kind === "park" &&
          Math.abs(wx + 0.5 - park.x - park.w / 2) > 1.15 &&
          Math.abs(wy + 0.5 - park.y - park.h / 2) > 0.95 &&
          hash01(wx, wy, 8) < 0.78;
        const plant =
          kind === "trees" || parkTree || (kind === "vacant" && hash01(wx, wy, 8) < 0.07);
        if (!plant) continue;
        const box = trees[Math.floor(hash01(wx, wy, 19) * trees.length)];
        const a = project(wx + 0.5, wy + 0.8);
        const tree = this.images.acquire();
        const treeH = parkTree ? 108 : 55;
        tree
          .setTexture(WILD_SHEETS.trees.file, ensureFrame(this.scene, WILD_SHEETS.trees.file, box))
          .setOrigin(0.5, 1)
          .setPosition(a.sx, a.sy)
          .setDisplaySize(box.w * (treeH / box.h), treeH)
          .setDepth(a.sy);
        treeImages.push(tree);
      }
    this.views.set(chunk.key, { key: chunk.key, ground, trees: treeImages });
    void height;
  }

  private texture(chunk: { key: string; x: number; y: number }, plan: CityPlan): string {
    const id = `${this.planId}:${chunk.key}`;
    const known = this.textures.get(id);
    if (known) {
      this.order.splice(this.order.indexOf(id), 1);
      this.order.push(id);
      return known;
    }
    const key = `terrain-${id}`;
    rasterizeChunk(this.scene, chunk.x, chunk.y, plan, key);
    this.generated++;
    this.textures.set(id, key);
    this.order.push(id);
    // Evict least-recently-used textures until back within capacity, skipping any
    // still on screen (and the one just made). Stopping at the first on-screen
    // entry used to let the cache creep past its capacity after a lap returned
    // to old ground.
    const onScreen = new Set<string>();
    for (const view of this.views.values()) onScreen.add(view.ground.texture.key);
    onScreen.add(key);
    while (this.order.length > this.capacity) {
      const victim = this.order.findIndex((entry) => !onScreen.has(this.textures.get(entry)!));
      if (victim === -1) break;
      const [evict] = this.order.splice(victim, 1);
      const evictKey = this.textures.get(evict)!;
      this.textures.delete(evict);
      this.scene.textures.remove(evictKey);
    }
    return key;
  }

  destroy(): void {
    for (const [key] of this.views) this.hide(key);
    for (const texture of this.textures.values()) this.scene.textures.remove(texture);
    this.textures.clear();
    this.images.destroy();
  }
}

function rasterizeChunk(scene: Phaser.Scene, cx: number, cy: number, plan: CityPlan, key: string): void {
  const n = CHUNK_SIZE,
    width = n * 72,
    height = n * 36;
  const g = scene.make.graphics({ x: 0, y: 0 });
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const wx = cx * n + i,
        wy = cy * n + j;
      const kind = tileKind(wx + 0.5, wy + 0.5, plan);
      const p = project(i, j);
      const slotVariant = hash01(Math.floor((wx + 0.5) / STRIDE_X), Math.floor((wy + 0.5) / STRIDE_Y), 19);
      const baseColor =
        kind === "vacant"
          ? slotVariant < 0.12
            ? 0xc7b99b
            : slotVariant < 0.4 && slotVariant >= 0.28
              ? 0xb6a27c
              : COLORS.vacant
          : COLORS[kind];
      const color = Phaser.Display.Color.IntegerToColor(baseColor);
      if (kind === "park") color.darken(hash01(wx, wy, 33) * 6);
      else color.lighten(hash01(wx, wy, 33) * 5);
      g.fillStyle(color.color, 1);
      g.fillPoints(
        [
          { x: p.sx + width / 2, y: p.sy },
          { x: p.sx + width / 2 + 36, y: p.sy + 18 },
          { x: p.sx + width / 2, y: p.sy + 36 },
          { x: p.sx + width / 2 - 36, y: p.sy + 18 },
        ].map((q) => new Phaser.Math.Vector2(q.x, q.y)),
        true,
      );
      if (kind === "freeway") {
        const local = ((wy % STRIDE_Y) + STRIDE_Y) % STRIDE_Y;
        if (Math.abs(local - STRIDE_Y * 0.18) < 0.45 || Math.abs(local - STRIDE_Y * 0.82) < 0.45) {
          g.lineStyle(1.5, 0xe6cf8b, 0.85);
          g.lineBetween(p.sx + width / 2 - 8, p.sy + 13, p.sx + width / 2 + 12, p.sy + 23);
        }
      }
      if (kind === "tram") {
        g.lineStyle(1.4, 0x515c53, 0.65);
        for (const offset of [-5, 5])
          g.lineBetween(p.sx + width / 2 + offset, p.sy + 5, p.sx + width / 2 - 25 + offset, p.sy + 18);
      }
      if (kind === "street") {
        g.lineStyle(1.4, 0xd8c889, 0.55);
        g.lineBetween(p.sx + width / 2 - 10, p.sy + 16, p.sx + width / 2 + 10, p.sy + 26);
      }
      if (kind === "bike") {
        g.fillStyle(0xa89c68, 1);
        g.fillPoints(
          [
            { x: p.sx + width / 2, y: p.sy + 1 },
            { x: p.sx + width / 2 + 34, y: p.sy + 17 },
            { x: p.sx + width / 2, y: p.sy + 33 },
            { x: p.sx + width / 2 - 34, y: p.sy + 17 },
          ].map((q) => new Phaser.Math.Vector2(q.x, q.y)),
          true,
        );
        const cx = p.sx + width / 2;
        const cy = p.sy + 18;
        g.fillStyle(0x2a2820, 1);
        g.fillPoints(
          [
            { x: cx + 28, y: cy + 6 },
            { x: cx - 24, y: cy - 16 },
            { x: cx - 4, y: cy + 3 },
            { x: cx - 22, y: cy + 20 },
          ].map((q) => new Phaser.Math.Vector2(q.x, q.y)),
          true,
        );
        g.fillStyle(0xf4ecd0, 1);
        g.fillPoints(
          [
            { x: cx + 20, y: cy + 5 },
            { x: cx - 14, y: cy - 10 },
            { x: cx - 1, y: cy + 3 },
            { x: cx - 13, y: cy + 16 },
          ].map((q) => new Phaser.Math.Vector2(q.x, q.y)),
          true,
        );
      }
      if (kind === "river" && hash01(wx, wy, 29) < 0.3) {
        g.lineStyle(1, 0xc1e0d4, 0.4);
        g.lineBetween(p.sx + width / 2 - 12, p.sy + 18, p.sx + width / 2 + 4, p.sy + 23);
      }
    }
  g.generateTexture(key, width, height);
  g.destroy();
}

/** Civic dressing: plaza, station, park paths, pond, benches, lamps and labels. */
export function drawCivics(scene: Phaser.Scene, plan: CityPlan): Phaser.GameObjects.GameObject[] {
  const g = scene.add.graphics().setDepth(-80_000);
  const objects: Phaser.GameObjects.GameObject[] = [g];
  function diamond(x: number, y: number, w: number, h: number, color: number, alpha = 1) {
    const p = [project(x, y), project(x + w, y), project(x + w, y + h), project(x, y + h)].map(
      (q) => new Phaser.Math.Vector2(q.sx, q.sy),
    );
    g.fillStyle(color, alpha);
    g.fillPoints(p, true);
  }
  const stamp = (box: { x: number; y: number; w: number; h: number }, wx: number, wy: number, w: number) => {
    const a = project(wx, wy);
    const image = scene.add
      .image(a.sx, a.sy, GROUND_SHEET.file, ensureFrame(scene, GROUND_SHEET.file, box))
      .setOrigin(0.5, 1)
      .setDisplaySize(w, w * (box.h / box.w))
      .setDepth(a.sy);
    objects.push(image);
    return image;
  };
  const placeName = (sx: number, sy: number, text: string, color: number, size: number) => {
    objects.push(
      scene.add.bitmapText(sx, sy, HUD_FONT.face, text, size).setTint(color).setOrigin(0.5).setDepth(sy + 6),
    );
  };
  const streetLabel = (wx: number, wy: number, text: string, id: string) => {
    const a = project(wx, wy);
    objects.push(districtPlaque(scene, a.sx, a.sy, text, id));
  };
  const plaza = plan.features.find((f) => f.kind === "plaza")!;
  diamond(plaza.x, plaza.y, plaza.w, plaza.h, 0xc4b69a);
  diamond(plaza.x + 0.25, plaza.y + 0.25, plaza.w - 0.5, plaza.h - 0.5, 0xd3c8a9);
  const station = project(plaza.x + plaza.w / 2, plaza.y + plaza.h / 2);
  // Platform shelter and sign at Park Station, where the tram dwells.
  const shelter = scene.add.graphics().setDepth(station.sy + 20);
  shelter.fillStyle(0x6b6f66, 1).fillRect(station.sx - 34, station.sy - 30, 68, 5);
  shelter.fillStyle(0x4f5450, 1).fillRect(station.sx - 32, station.sy - 25, 3, 26).fillRect(station.sx + 29, station.sy - 25, 3, 26);
  objects.push(shelter);
  placeName(station.sx, station.sy + 8, "PARK STATION", 0x586348, 12);
  stamp(DECOR_LAMP, plaza.x + 0.6, plaza.y + 0.6, 12);
  stamp(DECOR_LAMP, plaza.x + plaza.w - 0.6, plaza.y + plaza.h - 0.6, 12);
  stamp(DECOR_BENCH, plaza.x + plaza.w / 2 + 1.2, plaza.y + plaza.h / 2 + 1.1, 34);

  const park = plan.features.find((f) => f.kind === "park")!;
  const cx = park.x + park.w / 2,
    cy = park.y + park.h / 2;
  const hasOffice = plan.civics?.some((c) => c.kind === "office");
  // Dark forest lawn on the reserved 2×2 only — darker than vacant 0x8ea070 so
  // the campus reads at flyover without growing LAYOUT_VERSION 1 lot slots.
  diamond(park.x, park.y, park.w, park.h, 0x355028, 0.97);
  diamond(park.x + 0.12, park.y + 0.12, park.w - 0.24, park.h - 0.24, 0x2c4820, 0.94);
  const lawnTint = 0x4a6740;
  const canopyTint = 0x3f5c32;
  for (let gi = 0; gi < 4; gi++) {
    for (let gj = 0; gj < 4; gj++) {
      const lx = park.x + 1.15 + gi * 2.4;
      const ly = park.y + 0.95 + gj * 1.85;
      if (Math.abs(lx - cx) < 1.35 && Math.abs(ly - cy) < 1.15) continue;
      stamp(GROUND_TILES.parkGrass, lx, ly, 148).setTint(lawnTint);
    }
  }
  stamp(GROUND_TILES.parkSteps, cx, park.y + park.h - 0.45, 118).setTint(0xc4b69a);
  diamond(cx - 0.16, park.y, 0.32, park.h, 0xdccfa7, 0.88);
  diamond(park.x, cy - 0.16, park.w, 0.32, 0xdccfa7, 0.88);
  diamond(cx - 2.6, cy - 1.65, 5.2, 0.26, 0xdccfa7, 0.88);
  diamond(cx - 2.6, cy + 1.4, 5.2, 0.26, 0xdccfa7, 0.88);
  diamond(cx - 2.6, cy - 1.65, 0.26, 3.3, 0xdccfa7, 0.88);
  diamond(cx + 2.35, cy - 1.65, 0.26, 3.3, 0xdccfa7, 0.88);
  if (!hasOffice) {
    for (const [dx, dy] of [[-1.3, -1.0], [1.0, -1.0], [-1.3, 0.7], [1.0, 0.7]] as const)
      diamond(cx + dx, cy + dy, 0.5, 0.4, 0xd9a066, 0.9);
    const center = project(cx, cy);
    const fountain = scene.add.graphics().setDepth(center.sy);
    fountain.fillStyle(0xdcd5b7).fillEllipse(center.sx, center.sy, 76, 38);
    fountain.fillStyle(0x6a9aa4).fillEllipse(center.sx, center.sy - 3, 60, 27);
    fountain.lineStyle(2, 0xd8eeee, 0.9);
    fountain.lineBetween(center.sx, center.sy - 28, center.sx, center.sy - 6);
    fountain.strokeEllipse(center.sx, center.sy - 8, 25, 10);
    objects.push(fountain);
  }
  // KEEP fountain plaza in the south-east lawn — not a house, not the HQ pad.
  diamond(cx + 1.35, cy + 1.15, 3.2, 2.2, 0x2f5a52, 0.96);
  stamp(GROUND_TILES.waterTile, cx + 2.55, cy + 2.45, 168).setTint(0x3d6a62);
  stamp(GROUND_TILES.sandTile, cx + 1.55, cy + 1.55, 70).setTint(0xc4b69a);
  stamp(GROUND_TILES.parkSteps, cx + 2.15, cy + 2.95, 92).setTint(0xc4b69a);
  const fountainAt = project(cx + 2.5, cy + 2.2);
  const basin = scene.add.graphics().setDepth(fountainAt.sy + 2);
  basin.fillStyle(0xdcd5b7, 1).fillEllipse(fountainAt.sx, fountainAt.sy - 6, 96, 48);
  basin.fillStyle(0x3d6a62, 1).fillEllipse(fountainAt.sx, fountainAt.sy - 10, 74, 34);
  basin.fillStyle(0xc5ddd8, 0.92).fillEllipse(fountainAt.sx, fountainAt.sy - 14, 30, 13);
  basin.lineStyle(2, 0xd8eeee, 0.88);
  basin.lineBetween(fountainAt.sx, fountainAt.sy - 48, fountainAt.sx, fountainAt.sy - 12);
  basin.strokeEllipse(fountainAt.sx, fountainAt.sy - 18, 24, 10);
  objects.push(basin);
  // KEEP civic kiosk on the south-west lawn (restyled city-hall pad, not a house).
  {
    const kiosk = CIVIC_SPRITES["city-hall"];
    const at = project(cx - 2.9, cy + 2.4);
    objects.push(
      scene.add
        .image(at.sx, at.sy, CIVIC_SHEET.file, ensureFrame(scene, CIVIC_SHEET.file, kiosk))
        .setOrigin(0.5, 1)
        .setDisplaySize(118, 118 * (kiosk.h / kiosk.w))
        .setDepth(at.sy + 4),
    );
  }
  for (const [dx, dy] of [[-2.2, -2.15], [2.0, -2.15], [-2.2, 1.95], [2.0, 1.95]] as const)
    stamp(DECOR_BENCH, cx + dx, cy + dy, 40);
  for (const [dx, dy] of [[-3.0, -0.4], [3.0, -0.4], [-0.4, -2.9], [-0.4, 2.7]] as const)
    stamp(DECOR_LAMP, cx + dx, cy + dy, 14);
  for (const [dx, dy, box, w] of [
    [-3.2, -2.3, GROUND_TILES.treeRoundA, 118],
    [-2.1, -2.7, GROUND_TILES.pineA, 112],
    [-0.9, -3.0, GROUND_TILES.treeRoundB, 108],
    [0.15, -3.05, GROUND_TILES.pineB, 116],
    [1.2, -2.85, GROUND_TILES.treeRoundA, 110],
    [2.3, -2.4, GROUND_TILES.pineA, 114],
    [3.15, -1.5, GROUND_TILES.treeRoundB, 116],
    [3.45, -0.3, GROUND_TILES.pineB, 112],
    [3.4, 0.9, GROUND_TILES.treeRoundA, 114],
    [2.95, 2.0, GROUND_TILES.pineA, 110],
    [1.95, 2.65, GROUND_TILES.treeRoundB, 116],
    [0.7, 2.9, GROUND_TILES.pineB, 108],
    [-0.45, 2.85, GROUND_TILES.treeRoundA, 114],
    [-1.7, 2.55, GROUND_TILES.pineA, 110],
    [-2.8, 1.9, GROUND_TILES.treeRoundB, 116],
    [-3.45, 0.7, GROUND_TILES.pineB, 112],
    [-3.5, -0.45, GROUND_TILES.treeRoundA, 114],
    [-3.2, -1.45, GROUND_TILES.pineA, 108],
    [-1.85, -2.15, GROUND_TILES.bushA, 64],
    [1.75, -2.1, GROUND_TILES.bushA, 64],
    [-1.95, 2.15, GROUND_TILES.bushA, 66],
    [1.85, 2.2, GROUND_TILES.bushA, 66],
    [-3.35, 0.15, GROUND_TILES.bushA, 62],
    [3.2, 0.2, GROUND_TILES.bushA, 62],
    [0.05, -2.65, GROUND_TILES.bushA, 64],
    [0.15, 2.55, GROUND_TILES.bushA, 64],
  ] as const) {
    stamp(box, cx + dx, cy + dy, w).setTint(canopyTint);
  }
  // Vacant Moore-ring lawn only. Tall fringe trees used to cover neighbouring lot crowns.
  for (const v of plan.vacancies ?? []) {
    const fringe =
      v.sx >= PARK_SX0 - 1 &&
      v.sx <= PARK_SX1 + 1 &&
      v.sy >= PARK_SY0 - 1 &&
      v.sy <= PARK_SY1 + 1;
    if (!fringe) continue;
    diamond(v.x + 0.12, v.y + 0.08, 3.7, 2.15, 0x355028, 0.94);
    stamp(GROUND_TILES.parkGrass, v.x + 1.2, v.y + 1.15, 128).setTint(lawnTint);
    stamp(GROUND_TILES.bushA, v.x + 2.2, v.y + 0.95, 58).setTint(canopyTint);
  }

  for (const f of plan.features)
    if (f.kind !== "plaza" && f.kind !== "river" && f.kind !== "bike" && f.kind !== "office") {
      const a = project(f.x + f.w / 2, f.kind === "tram" ? f.y + 1.2 : f.y + f.h / 2);
      placeName(
        a.sx,
        a.sy + (f.kind === "park" ? 78 : 0),
        f.kind === "park" ? "CENTRAL PARK" : f.kind === "freeway" ? "NORTH FREEWAY" : "TRAM LINE",
        f.kind === "freeway" ? 0xe2dac5 : 0x45614e,
        f.kind === "park" ? 16 : 13,
      );
    }
  for (const label of plan.labels ?? []) {
    streetLabel(label.x, label.y, label.text, label.id);
  }

  const civicWidth: Record<CivicKind, number> = {
    office: OFFICE_STAMP_WIDTH,
    plant: 48,
    odd: 120,
    parking: 138,
    gate: 100,
    road: ROAD_STAMP_WIDTH,
    bike: BIKE_STAMP_WIDTH,
  };
  ensureBikeMarkTextures(scene);
  const paintBikeBand = (x: number, streetY: number, w: number, band: number, glance: boolean) => {
    if (glance) {
      const mid = project(x + w / 2, streetY + band * 0.5);
      const bandG = scene.add.graphics().setDepth(mid.sy - 4);
      objects.push(bandG);
      for (let sx = plan.slotBounds.minSx; sx <= plan.slotBounds.maxSx; sx++) {
        const laneX = x + (sx - plan.slotBounds.minSx) * STRIDE_X;
        const outline = [
          project(laneX - 0.06, streetY - 0.06),
          project(laneX + STRIDE_X + 0.06, streetY - 0.06),
          project(laneX + STRIDE_X + 0.06, streetY + band + 0.06),
          project(laneX - 0.06, streetY + band + 0.06),
        ].map((q) => new Phaser.Math.Vector2(q.sx, q.sy));
        bandG.fillStyle(0x3f3c34, 1);
        bandG.fillPoints(outline, true);
        const fill = [
          project(laneX, streetY),
          project(laneX + STRIDE_X, streetY),
          project(laneX + STRIDE_X, streetY + band),
          project(laneX, streetY + band),
        ].map((q) => new Phaser.Math.Vector2(q.sx, q.sy));
        bandG.fillStyle(0xa89c68, 1);
        bandG.fillPoints(fill, true);
      }
    }
    const span = plan.slotBounds.maxSx - plan.slotBounds.minSx + 1;
    const chevronStep = glance ? 2 : Math.max(2, Math.ceil(span / 6));
    const labelStep = glance ? 3 : Math.max(3, Math.ceil(span / 4));
    for (let sx = plan.slotBounds.minSx; sx <= plan.slotBounds.maxSx; sx += chevronStep) {
      const laneX = x + (sx - plan.slotBounds.minSx) * STRIDE_X;
      const ch = paintIsoChevron(scene, laneX + 2.0, streetY + band * 0.5, glance);
      if (glance) ch.setData("bikeLaneFreeway", true);
      objects.push(ch);
    }
    for (let sx = plan.slotBounds.minSx + 2; sx <= plan.slotBounds.maxSx; sx += labelStep) {
      const at = project(
        x + (sx - plan.slotBounds.minSx) * STRIDE_X + (glance ? 1.2 : 1.6),
        streetY + band * (glance ? 1.12 : 0.55),
      );
      objects.push(bikeLanePlaque(scene, at.sx, at.sy + (glance ? 6 : 6), glance));
    }
  };
  for (const row of plan.streetRows) {
    const x = plan.slotBounds.minSx * STRIDE_X;
    const w = (plan.slotBounds.maxSx - plan.slotBounds.minSx + 1) * STRIDE_X;
    const streetY = row * STRIDE_Y + LOT_D + SHOULDER;
    diamond(x, streetY + BIKE_BAND, w, 0.32, 0x5e6662, 0.96);
    paintBikeBand(x, streetY, w, BIKE_BAND, false);
  }
  const freewayBike = plan.features.find((f) => f.id === "freeway-bike-lane");
  if (freewayBike) paintBikeBand(freewayBike.x, freewayBike.y, freewayBike.w, freewayBike.h, true);
  for (const marker of plan.civics ?? []) {
    const box = CIVIC_SPRITES[marker.sprite];
    if (!box) continue;
    const width =
      marker.kind === "plant" && marker.id.startsWith("park-plant-")
        ? 108
        : marker.kind === "odd"
          ? oddDisplayWidth(marker.sprite, scene.cameras.main.zoom)
          : civicWidth[marker.kind] ?? 100;
    const a = project(marker.x, marker.y);
    const depth =
      marker.kind === "bike" ? a.sy - 8 : marker.kind === "road" ? a.sy - 12 : a.sy + (marker.kind === "office" ? 8 : 0);
    const stamp = scene.add
      .image(a.sx, a.sy, CIVIC_SHEET.file, ensureFrame(scene, CIVIC_SHEET.file, box))
      .setOrigin(0.5, 1)
      .setDisplaySize(width, width * (box.h / box.w))
      .setDepth(depth);
    if (marker.kind === "odd") {
      stamp.setData("oddSprite", marker.sprite);
      stamp.setData("oddBox", box);
    }
    objects.push(stamp);
    if (marker.kind === "office") {
      placeName(a.sx, a.sy + 18, "CITY OFFICE", 0x45614e, 13);
      dressOfficeCourtyard(scene, objects, a.sx, a.sy, depth);
      for (const [dx, dy, sprite, w] of [
        [-0.95, 0.88, "plant-0", 68],
        [1.05, 0.92, "plant-1", 68],
        [0.1, 1.28, "plant-5", 54],
      ] as const) {
        const pot = CIVIC_SPRITES[sprite];
        const at = project(marker.x + dx, marker.y + dy);
        objects.push(
          scene.add
            .image(at.sx, at.sy, CIVIC_SHEET.file, ensureFrame(scene, CIVIC_SHEET.file, pot))
            .setOrigin(0.5, 1)
            .setDisplaySize(w, w * (pot.h / pot.w))
            .setDepth(at.sy + 22),
        );
      }
    }
  }
  return objects;
}

function ensureBikeMarkTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists("bike-chevron-k1")) return;
  const g = scene.make.graphics({ x: 0, y: 0 });
  const poly = (pts: Array<[number, number]>) =>
    g.fillPoints(
      pts.map(([x, y]) => new Phaser.Math.Vector2(x, y)),
      true,
    );
  const chevron = (ox: number, oy: number, s: number): Array<[number, number]> => [
    [ox + 70 * s, oy + 28 * s],
    [ox + 4 * s, oy + 3 * s],
    [ox + 24 * s, oy + 28 * s],
    [ox + 4 * s, oy + 53 * s],
  ];
  g.fillStyle(0x1a1814, 1);
  poly(chevron(6, 6, 1.15));
  poly(chevron(78, 6, 1.15));
  g.fillStyle(0xece3b8, 1);
  poly(chevron(14, 11, 0.96));
  poly(chevron(86, 11, 0.96));
  g.fillStyle(0xfff8e0, 1);
  poly(chevron(24, 16, 0.72));
  poly(chevron(96, 16, 0.72));
  g.generateTexture("bike-chevron-k1", 176, 72);
  g.destroy();
}

function isoChevronWorld(wx: number, wy: number, ox: number, len: number, half: number, notch: number) {
  const cx = wx + ox;
  return [project(cx + len, wy), project(cx, wy - half), project(cx + notch, wy), project(cx, wy + half)];
}

function paintIsoChevron(scene: Phaser.Scene, wx: number, wy: number, glance: boolean): Phaser.GameObjects.Graphics {
  const len = glance ? 5.1 : 0.95;
  const half = glance ? 1.42 : 0.38;
  const notch = glance ? 1.2 : 0.26;
  const gap = glance ? 2.7 : 0.7;
  const mid = project(wx + gap * 0.5 + len * 0.4, wy);
  const g = scene.add.graphics();
  const local = (p: { sx: number; sy: number }) => new Phaser.Math.Vector2(p.sx - mid.sx, p.sy - mid.sy);
  const draw = (ox: number, extraLen: number, extraHalf: number) =>
    g.fillPoints(isoChevronWorld(wx, wy, ox, len + extraLen, half + extraHalf, notch).map(local), true);
  g.fillStyle(0x1a1814, 1);
  draw(-0.22, 0.42, 0.28);
  draw(gap - 0.22, 0.42, 0.28);
  g.fillStyle(0xece3b8, 1);
  draw(0, 0, 0);
  draw(gap, 0, 0);
  g.fillStyle(0xfff8e0, 1);
  draw(0.42, -0.9, -0.38);
  draw(gap + 0.42, -0.9, -0.38);
  const pts = [
    ...isoChevronWorld(wx, wy, -0.12, len + 0.24, half + 0.16, notch),
    ...isoChevronWorld(wx, wy, gap - 0.12, len + 0.24, half + 0.16, notch),
  ].map(local);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  g.setPosition(mid.sx, mid.sy);
  g.setDepth(mid.sy + 26);
  g.setData("bikeLaneMark", true);
  g.setData("bikeLaneGlance", glance);
  g.setData("bikeLaneChevron", true);
  g.setData("markW", Math.max(...xs) - Math.min(...xs));
  g.setData("markH", Math.max(...ys) - Math.min(...ys));
  return g;
}

/** Overlay lawn/path/fountain on the HQ stamp's stone pad. Does not replace the building. */
function dressOfficeCourtyard(
  scene: Phaser.Scene,
  objects: Phaser.GameObjects.GameObject[],
  ox: number,
  oy: number,
  officeDepth: number,
): void {
  const g = scene.add.graphics().setDepth(officeDepth + 6);
  const p = (x: number, y: number) => new Phaser.Math.Vector2(ox + x, oy + y);
  g.fillStyle(0x627a4e, 0.94);
  g.fillPoints([p(0, -36), p(148, -118), p(0, -188), p(-148, -118)], true);
  g.fillStyle(0xdccfa7, 0.94);
  g.fillPoints([p(0, -58), p(92, -118), p(0, -168), p(-92, -118)], true);
  g.fillPoints([p(18, -40), p(68, -62), p(30, -84), p(-10, -62)], true);
  g.fillStyle(0x6e8458, 0.94);
  g.fillPoints([p(0, -80), p(60, -118), p(0, -148), p(-60, -118)], true);
  g.fillStyle(0xdcd5b7, 1);
  g.fillEllipse(ox, oy - 118, 64, 32);
  g.fillStyle(0x6a9094, 1);
  g.fillEllipse(ox, oy - 120, 44, 20);
  g.fillStyle(0xc5ddd8, 0.9);
  g.fillEllipse(ox, oy - 122, 18, 8);
  objects.push(g);
  for (const [dx, dy] of [
    [-88, -102],
    [88, -102],
    [0, -72],
  ] as const) {
    objects.push(
      scene.add
        .image(ox + dx, oy + dy, GROUND_SHEET.file, ensureFrame(scene, GROUND_SHEET.file, DECOR_BENCH))
        .setOrigin(0.5, 1)
        .setDisplaySize(34, 34 * (DECOR_BENCH.h / DECOR_BENCH.w))
        .setDepth(officeDepth + 8),
    );
  }
  for (const [dx, dy, sprite, w] of [
    [-110, -126, "plant-2", 52],
    [112, -128, "plant-3", 52],
    [-8, -162, "plant-5", 44],
    [-58, -148, "plant-0", 48],
    [56, -150, "plant-1", 48],
  ] as const) {
    const pot = CIVIC_SPRITES[sprite];
    objects.push(
      scene.add
        .image(ox + dx, oy + dy, CIVIC_SHEET.file, ensureFrame(scene, CIVIC_SHEET.file, pot))
        .setOrigin(0.5, 1)
        .setDisplaySize(w, w * (pot.h / pot.w))
        .setDepth(officeDepth + 10),
    );
  }
}

function districtPlaque(
  scene: Phaser.Scene,
  sx: number,
  sy: number,
  text: string,
  id: string,
): Phaser.GameObjects.Container {
  const w = Math.max(148, text.length * 9 + 20);
  const h = 24;
  const plaque = scene.add.graphics();
  plaque.fillStyle(0x2a3828, 0.9);
  plaque.fillRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 5);
  plaque.fillStyle(0x3f5a44, 0.96);
  plaque.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
  const label = scene.add
    .bitmapText(0, 1, HUD_FONT.face, text, 13)
    .setTint(0xf2efe2)
    .setOrigin(0.5);
  const box = scene.add.container(sx, sy, [plaque, label]);
  box.setSize(w, h);
  box.setDepth(sy + 14);
  box.setName(`label-${id}`);
  box.setData("mapLabel", id);
  box.setData("mapLabelText", text);
  return box;
}

function bikeLanePlaque(scene: Phaser.Scene, sx: number, sy: number, glance: boolean): Phaser.GameObjects.Container {
  const w = glance ? 132 : 100;
  const h = glance ? 30 : 22;
  const plaque = scene.add.graphics();
  plaque.fillStyle(0x3f3c34, 0.94);
  plaque.fillRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 5);
  plaque.fillStyle(0x5c4e38, 0.96);
  plaque.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
  const text = scene.add
    .bitmapText(0, 1, HUD_FONT.face, "BIKE LANE", glance ? 18 : 13)
    .setTint(0xf4ecd0)
    .setOrigin(0.5);
  const box = scene.add.container(sx, sy, [plaque, text]);
  box.setSize(w, h);
  box.setDepth(sy + 12);
  box.setData("bikeLaneMark", true);
  box.setData("bikeLaneGlance", glance);
  box.setData("bikeLanePlaque", true);
  return box;
}
