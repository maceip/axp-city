import Phaser from "phaser";
import { project } from "../../src/render/iso.js";
import { hash01, type CityPlan, type CivicKind, tileKind } from "../../src/world/index.js";
import { BIKE_BAND, LOT_D, SHOULDER, STRIDE_X, STRIDE_Y } from "../../src/world/constants.js";
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
  OFFICE_STAMP_WIDTH,
  ROAD_STAMP_WIDTH,
} from "../../src/render/sprites.js";
import { imagePool, type ObjectPool } from "./pool.js";
import { ensureFrame } from "./stamps.js";

const trees = WILD_TREES.filter((box) => box.h >= 50 && box.w < 130);
const COLORS: Record<string, number> = {
  park: 0x84ad65,
  freeway: 0x52606b,
  tram: 0x8f9890,
  river: 0x69adb0,
  lot: 0x9daf7c,
  vacant: 0x96b776,
  street: 0x5e6662,
  bike: 0x3d7a1c,
  grass: 0x91b477,
  dirt: 0xb7ae80,
  water: 0x89b49b,
  trees: 0x89ab6e,
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
        const plant =
          kind === "trees" ||
          (kind === "park" &&
            Math.abs(wx + 0.5 - park.x - park.w / 2) > 1.4 &&
            Math.abs(wy + 0.5 - park.y - park.h / 2) > 1.2 &&
            hash01(wx, wy, 8) < 0.16) ||
          (kind === "vacant" && hash01(wx, wy, 8) < 0.07);
        if (!plant) continue;
        const box = trees[Math.floor(hash01(wx, wy, 19) * trees.length)];
        const a = project(wx + 0.5, wy + 0.8);
        const tree = this.images.acquire();
        tree
          .setTexture(WILD_SHEETS.trees.file, ensureFrame(this.scene, WILD_SHEETS.trees.file, box))
          .setOrigin(0.5, 1)
          .setPosition(a.sx, a.sy)
          .setDisplaySize(box.w * (55 / box.h), 55)
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
      color.lighten(hash01(wx, wy, 33) * 5);
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
        if (Math.abs(local - STRIDE_Y * 0.47) < 0.55) {
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
        g.fillStyle(0x3d7a1c, 1);
        g.fillPoints(
          [
            { x: p.sx + width / 2, y: p.sy + 2 },
            { x: p.sx + width / 2 + 28, y: p.sy + 16 },
            { x: p.sx + width / 2, y: p.sy + 30 },
            { x: p.sx + width / 2 - 28, y: p.sy + 16 },
          ].map((q) => new Phaser.Math.Vector2(q.x, q.y)),
          true,
        );
        g.fillStyle(0xfff4b0, 0.95);
        g.fillPoints(
          [
            { x: p.sx + width / 2 - 6, y: p.sy + 10 },
            { x: p.sx + width / 2 + 2, y: p.sy + 14 },
            { x: p.sx + width / 2 - 6, y: p.sy + 18 },
            { x: p.sx + width / 2 + 10, y: p.sy + 16 },
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
  const g = scene.add.graphics().setDepth(-99_990);
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
  const plaza = plan.features.find((f) => f.kind === "plaza")!;
  diamond(plaza.x, plaza.y, plaza.w, plaza.h, 0xc4b69a);
  diamond(plaza.x + 0.25, plaza.y + 0.25, plaza.w - 0.5, plaza.h - 0.5, 0xd3c8a9);
  const station = project(plaza.x + plaza.w / 2, plaza.y + plaza.h / 2);
  // Platform shelter and sign at Park Station, where the tram dwells.
  const shelter = scene.add.graphics().setDepth(station.sy + 20);
  shelter.fillStyle(0x6b6f66, 1).fillRect(station.sx - 34, station.sy - 30, 68, 5);
  shelter.fillStyle(0x4f5450, 1).fillRect(station.sx - 32, station.sy - 25, 3, 26).fillRect(station.sx + 29, station.sy - 25, 3, 26);
  objects.push(shelter);
  objects.push(
    scene.add
      .text(station.sx, station.sy + 8, "PARK STATION", { fontFamily: "monospace", fontSize: "9px", color: "#586348", letterSpacing: 1 })
      .setOrigin(0.5)
      .setDepth(-90_000),
  );
  stamp(DECOR_LAMP, plaza.x + 0.6, plaza.y + 0.6, 12);
  stamp(DECOR_LAMP, plaza.x + plaza.w - 0.6, plaza.y + plaza.h - 0.6, 12);
  stamp(DECOR_BENCH, plaza.x + plaza.w / 2 + 1.2, plaza.y + plaza.h / 2 + 1.1, 34);

  const park = plan.features.find((f) => f.kind === "park")!;
  const cx = park.x + park.w / 2,
    cy = park.y + park.h / 2;
  const hasOffice = plan.civics?.some((c) => c.kind === "office");
  // Paths: a cross and a ring around the fountain / office.
  diamond(cx - 0.18, park.y, 0.36, park.h, 0xdccfa7);
  diamond(park.x, cy - 0.18, park.w, 0.36, 0xdccfa7);
  diamond(cx - 2.8, cy - 1.8, 5.6, 0.3, 0xdccfa7);
  diamond(cx - 2.8, cy + 1.5, 5.6, 0.3, 0xdccfa7);
  diamond(cx - 2.8, cy - 1.8, 0.3, 3.6, 0xdccfa7);
  diamond(cx + 2.5, cy - 1.8, 0.3, 3.6, 0xdccfa7);
  if (!hasOffice) {
    for (const [dx, dy] of [[-1.3, -1.0], [1.0, -1.0], [-1.3, 0.7], [1.0, 0.7]] as const)
      diamond(cx + dx, cy + dy, 0.5, 0.4, 0xd9a066, 0.9);
    const center = project(cx, cy);
    const fountain = scene.add.graphics().setDepth(center.sy);
    fountain.fillStyle(0xdcd5b7).fillEllipse(center.sx, center.sy, 76, 38);
    fountain.fillStyle(0x75b8c0).fillEllipse(center.sx, center.sy - 3, 60, 27);
    fountain.lineStyle(2, 0xd8eeee, 0.9);
    fountain.lineBetween(center.sx, center.sy - 28, center.sx, center.sy - 6);
    fountain.strokeEllipse(center.sx, center.sy - 8, 25, 10);
    objects.push(fountain);
  }
  // Pond in the south-east quadrant.
  diamond(park.x + park.w * 0.66, park.y + park.h * 0.62, 2.0, 1.4, 0x4ea2d6);
  stamp(GROUND_TILES.waterTile, park.x + park.w * 0.66 + 1.0, park.y + park.h * 0.62 + 1.3, 70);
  stamp(GROUND_TILES.sandTile, park.x + park.w * 0.66 - 0.2, park.y + park.h * 0.62 + 0.3, 40);
  // Benches and lamps along the ring path.
  for (const [dx, dy] of [[-2.2, -2.15], [2.0, -2.15], [-2.2, 1.95], [2.0, 1.95]] as const)
    stamp(DECOR_BENCH, cx + dx, cy + dy, 34);
  for (const [dx, dy] of [[-3.0, -0.4], [3.0, -0.4], [-0.4, -2.9], [-0.4, 2.7]] as const)
    stamp(DECOR_LAMP, cx + dx, cy + dy, 11);
  for (const [dx, dy, box] of [
    [-3.6, -2.6, GROUND_TILES.treeRoundA],
    [3.4, -2.6, GROUND_TILES.pineA],
    [-3.6, 2.3, GROUND_TILES.pineB],
    [3.4, 2.3, GROUND_TILES.treeRoundB],
    [-1.6, -3.1, GROUND_TILES.bushA],
    [1.4, 2.9, GROUND_TILES.bushA],
  ] as const)
    stamp(box, cx + dx, cy + dy, box === GROUND_TILES.bushA ? 34 : 40);

  for (const f of plan.features)
    if (f.kind !== "plaza" && f.kind !== "river" && f.kind !== "bike" && f.kind !== "office") {
      const a = project(f.x + f.w / 2, f.kind === "tram" ? f.y + 1.2 : f.y + f.h / 2);
      objects.push(
        scene.add
          .text(
            a.sx,
            a.sy + (f.kind === "park" ? 90 : 0),
            f.kind === "park" ? "CENTRAL PARK" : f.kind === "freeway" ? "NORTH FREEWAY" : "TRAM LINE",
            { fontFamily: "monospace", fontSize: "11px", color: f.kind === "freeway" ? "#e2dac5" : "#45614e", letterSpacing: 2 },
          )
          .setOrigin(0.5)
          .setDepth(-90_000),
      );
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
  for (const row of plan.streetRows) {
    const x = plan.slotBounds.minSx * STRIDE_X;
    const w = (plan.slotBounds.maxSx - plan.slotBounds.minSx + 1) * STRIDE_X;
    const streetY = row * STRIDE_Y + LOT_D + SHOULDER;
    diamond(x, streetY + BIKE_BAND, w, 0.58, 0x5e6662, 0.96);
    diamond(x, streetY, w, BIKE_BAND, 0x3d7a1c, 0.98);
    diamond(x, streetY + BIKE_BAND - 0.08, w, 0.1, 0xf4efc2, 0.96);
    for (let sx = plan.slotBounds.minSx; sx <= plan.slotBounds.maxSx; sx++) {
      const laneX = x + (sx - plan.slotBounds.minSx) * STRIDE_X;
      diamond(laneX + 0.55, streetY + 0.12, 1.55, 0.42, 0xfff4b0, 0.96);
      diamond(laneX + 2.35, streetY + 0.28, 1.15, 0.32, 0xfff4b0, 0.88);
    }
    const labelAt = project(x + 1.6, streetY + BIKE_BAND * 0.42);
    objects.push(
      scene.add
        .text(labelAt.sx, labelAt.sy, "BIKE LANE", {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#fff4b0",
          letterSpacing: 2,
        })
        .setOrigin(0.5)
        .setDepth(-90_000),
    );
  }
  for (const marker of plan.civics ?? []) {
    const box = CIVIC_SPRITES[marker.sprite];
    if (!box) continue;
    const width = civicWidth[marker.kind] ?? 100;
    const a = project(marker.x, marker.y);
    const depth =
      marker.kind === "bike" ? -99_994 : marker.kind === "road" ? -99_996 : a.sy + (marker.kind === "office" ? 8 : 0);
    objects.push(
      scene.add
        .image(a.sx, a.sy, CIVIC_SHEET.file, ensureFrame(scene, CIVIC_SHEET.file, box))
        .setOrigin(0.5, 1)
        .setDisplaySize(width, width * (box.h / box.w))
        .setDepth(depth),
    );
    if (marker.kind === "office") {
      objects.push(
        scene.add
          .text(a.sx, a.sy + 18, "CITY OFFICE", {
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#45614e",
            letterSpacing: 2,
          })
          .setOrigin(0.5)
          .setDepth(-90_000),
      );
    }
  }
  return objects;
}
