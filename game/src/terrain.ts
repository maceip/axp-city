import Phaser from "phaser";
import { project } from "../../src/render/iso.js";
import { hash01, type CityPlan, tileKind } from "../../src/world/index.js";
import { STRIDE_X, STRIDE_Y } from "../../src/world/constants.js";
import { CHUNK_SIZE } from "../../src/game/visibility.js";
import {
  WILD_SHEETS,
  WILD_TREES,
  GROUND_SHEET,
  DECOR_BENCH,
} from "../../src/render/sprites.js";
import { ensureFrame } from "./stamps.js";
export interface TerrainChunk {
  objects: Phaser.GameObjects.GameObject[];
  texture: string;
}
const trees = WILD_TREES.filter((box) => box.h >= 50 && box.w < 130);
const COLORS: Record<string, number> = {
  park: 0x84ad65,
  freeway: 0x52606b,
  tram: 0x8f9890,
  river: 0x69adb0,
  lot: 0x9daf7c,
  vacant: 0x96b776,
  street: 0x89938b,
  grass: 0x91b477,
  dirt: 0xb7ae80,
  water: 0x89b49b,
  trees: 0x89ab6e,
};
export function makeChunk(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  plan: CityPlan,
): TerrainChunk {
  const n = CHUNK_SIZE,
    width = n * 72,
    height = n * 36;
  const origin = project(cx * n, cy * n);
  const g = scene.make.graphics({ x: 0, y: 0 });
  const objects: Phaser.GameObjects.GameObject[] = [];
  const park = plan.features.find((feature) => feature.kind === "park")!;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const wx = cx * n + i,
        wy = cy * n + j;
      const kind = tileKind(wx + 0.5, wy + 0.5, plan);
      const p = project(i, j);
      const slotVariant = hash01(
        Math.floor((wx + 0.5) / STRIDE_X),
        Math.floor((wy + 0.5) / STRIDE_Y),
        19,
      );
      const baseColor =
        kind === "vacant"
          ? slotVariant < 0.12
            ? 0xc7b99b
            : slotVariant < 0.4 && slotVariant >= 0.28
              ? 0xb6a27c
              : COLORS.vacant
          : COLORS[kind];
      const color = Phaser.Display.Color.IntegerToColor(baseColor);
      const tint = hash01(wx, wy, 33) * 5;
      color.lighten(tint);
      g.fillStyle(color.color, 1);
      g.fillPoints(
        [
          { x: p.sx + width / 2, y: p.sy },
          { x: p.sx + width / 2 + 36, y: p.sy + 18 },
          { x: p.sx + width / 2, y: p.sy + 36 },
          { x: p.sx + width / 2 - 36, y: p.sy + 18 },
        ].map((p) => new Phaser.Math.Vector2(p.x, p.y)),
        true,
      );
      if (
        kind === "freeway" &&
        Math.abs((((wy % 4.1) + 4.1) % 4.1) - 1.7) < 0.55
      ) {
        g.lineStyle(1.5, 0xe6cf8b, 0.85);
        g.lineBetween(
          p.sx + width / 2 - 8,
          p.sy + 13,
          p.sx + width / 2 + 12,
          p.sy + 23,
        );
      }
      if (kind === "tram") {
        g.lineStyle(1.4, 0x515c53, 0.65);
        for (const offset of [-5, 5])
          g.lineBetween(
            p.sx + width / 2 + offset,
            p.sy + 5,
            p.sx + width / 2 - 25 + offset,
            p.sy + 18,
          );
      }
      if (kind === "river" && hash01(wx, wy, 29) < 0.3) {
        g.lineStyle(1, 0xc1e0d4, 0.4);
        g.lineBetween(
          p.sx + width / 2 - 12,
          p.sy + 18,
          p.sx + width / 2 + 4,
          p.sy + 23,
        );
      }
      const plant =
        kind === "trees" ||
        (kind === "park" &&
          Math.abs(wx + 0.5 - park.x - park.w / 2) > 0.75 &&
          Math.abs(wy + 0.5 - park.y - park.h / 2) > 0.65 &&
          hash01(wx, wy, 8) < 0.22) ||
        (kind === "vacant" && hash01(wx, wy, 8) < 0.07);
      if (plant) {
        const box = trees[Math.floor(hash01(wx, wy, 19) * trees.length)];
        const a = project(wx + 0.5, wy + 0.8);
        const tree = scene.add.image(
          a.sx,
          a.sy,
          WILD_SHEETS.trees.file,
          ensureFrame(scene, WILD_SHEETS.trees.file, box),
        );
        tree
          .setOrigin(0.5, 1)
          .setDisplaySize(box.w * (55 / box.h), 55)
          .setDepth(a.sy);
        objects.push(tree);
      }
    }
  const texture = `terrain-${cx}-${cy}`;
  g.generateTexture(texture, width, height);
  g.destroy();
  const image = scene.add
    .image(origin.sx - width / 2, origin.sy, texture)
    .setOrigin(0, 0)
    .setDepth(-1_000_000);
  objects.push(image);
  return { objects, texture };
}
export function drawCivics(
  scene: Phaser.Scene,
  plan: CityPlan,
): Phaser.GameObjects.GameObject[] {
  const g = scene.add.graphics().setDepth(-99_990);
  const objects: Phaser.GameObjects.GameObject[] = [g];
  function diamond(x: number, y: number, w: number, h: number, color: number) {
    const p = [
      project(x, y),
      project(x + w, y),
      project(x + w, y + h),
      project(x, y + h),
    ].map((p) => new Phaser.Math.Vector2(p.sx, p.sy));
    g.fillStyle(color);
    g.fillPoints(p, true);
  }
  const plaza = plan.features.find((f) => f.kind === "plaza")!;
  diamond(plaza.x, plaza.y, plaza.w, plaza.h, 0xc4b69a);
  diamond(
    plaza.x + 0.25,
    plaza.y + 0.25,
    plaza.w - 0.5,
    plaza.h - 0.5,
    0xd3c8a9,
  );
  const station = project(plaza.x + plaza.w / 2, plaza.y + plaza.h / 2);
  const stationSign = scene.add
    .text(station.sx, station.sy, "PARK STATION", {
      fontFamily: "monospace",
      fontSize: "9px",
      color: "#586348",
      letterSpacing: 1,
    })
    .setOrigin(0.5)
    .setDepth(-90_000);
  objects.push(stationSign);
  const park = plan.features.find((f) => f.kind === "park")!;
  diamond(park.x + park.w / 2 - 0.18, park.y, 0.36, park.h, 0xdccfa7);
  diamond(park.x, park.y + park.h / 2 - 0.18, park.w, 0.36, 0xdccfa7);
  const center = project(park.x + park.w / 2, park.y + park.h / 2);
  const fountain = scene.add.graphics().setDepth(center.sy);
  fountain.fillStyle(0xdcd5b7).fillEllipse(center.sx, center.sy, 76, 38);
  fountain.fillStyle(0x75b8c0).fillEllipse(center.sx, center.sy - 3, 60, 27);
  fountain.lineStyle(2, 0xd8eeee, 0.9);
  fountain.lineBetween(center.sx, center.sy - 28, center.sx, center.sy - 6);
  fountain.strokeEllipse(center.sx, center.sy - 8, 25, 10);
  objects.push(fountain);
  for (const sign of [-1, 1]) {
    const a = project(
      park.x + park.w / 2 + sign * 2,
      park.y + park.h / 2 + 0.8,
    );
    const bench = scene.add
      .image(
        a.sx,
        a.sy,
        GROUND_SHEET.file,
        ensureFrame(scene, GROUND_SHEET.file, DECOR_BENCH),
      )
      .setOrigin(0.5, 1)
      .setDisplaySize(40, 18)
      .setDepth(a.sy);
    objects.push(bench);
  }
  for (const f of plan.features)
    if (f.kind !== "plaza" && f.kind !== "river") {
      const a = project(
        f.x + f.w / 2,
        f.kind === "tram" ? f.y + 1.2 : f.y + f.h / 2,
      );
      const label = scene.add
        .text(
          a.sx,
          a.sy + (f.kind === "park" ? 70 : 0),
          f.kind === "park"
            ? "CENTRAL PARK"
            : f.kind === "freeway"
              ? "NORTH FREEWAY"
              : "TRAM LINE",
          {
            fontFamily: "monospace",
            fontSize: "11px",
            color: f.kind === "freeway" ? "#e2dac5" : "#45614e",
            letterSpacing: 2,
          },
        )
        .setOrigin(0.5)
        .setDepth(-90_000);
      objects.push(label);
    }
  return objects;
}
