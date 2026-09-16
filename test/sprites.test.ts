import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANIM_SHEETS,
  BIKE_STAMP_WIDTH,
  BUILDING_SHEETS,
  CIVIC_SHEET,
  CIVIC_SPRITES,
  CREW_CARRY,
  CREW_WALK,
  DRONE_QUADS,
  GROUND_SHEET,
  GROUND_TILES,
  HUD_FRAMES,
  HUD_SHEET,
  MATERIAL_LOOSE,
  MATERIAL_PALLETS,
  PLANNING_TABLES,
  PROP_BOXES,
  PROP_SHEETS,
  ROAD_STAMP_WIDTH,
  propPlacement,
  sheetForBand,
  spriteBoxFor,
  spritePlacement,
  WILD_BUSHES,
  WILD_SHEETS,
  WILD_TREES,
  WILD_WATER,
} from "../src/render/sprites.js";

describe("building sprite atlas", () => {
  it("does not crop the first-row roofs or combine neighboring bottom-row buildings", () => {
    for (let id = 18; id <= 22; id++)
      expect(spriteBoxFor(id).y).toBeLessThan(40);
    for (let id = 35; id <= 38; id++)
      expect(spriteBoxFor(id).y).toBeLessThan(25);
    const last = [47, 48, 49, 50].map(spriteBoxFor);
    for (let i = 0; i < last.length - 1; i++)
      expect(last[i].x + last[i].w).toBeLessThan(last[i + 1].x);
  });
  it("covers all 50 catalog ids inside their sheets", () => {
    for (let id = 1; id <= 50; id++) {
      const band = id <= 17 ? "S" : id <= 34 ? "M" : "L";
      const sheet = sheetForBand(band);
      const box = spriteBoxFor(id);
      expect(box.w).toBeGreaterThan(0);
      expect(box.h).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(sheet.width);
      expect(box.y + box.h).toBeLessThanOrEqual(sheet.height);
    }
  });

  it("ships the sheet files the renderer references", () => {
    for (const sheet of Object.values(BUILDING_SHEETS)) {
      expect(existsSync(join("assets", "city-sprites", sheet.file))).toBe(true);
    }
  });

  it("lands the stamp bottom-center on the pad at lot scale", () => {
    const sheet = sheetForBand("S");
    const box = spriteBoxFor(1);
    const p = spritePlacement(sheet, box, 1.4, 1.4);
    const s = 230.4 / box.w;
    const cx = (1.4 - 1.4 - 0.2) * 36;
    const cy = (1.4 + 1.4 + 2.2) * 18;
    expect(p.clipW).toBeCloseTo(230.4, 6);
    expect(p.clipH).toBeCloseTo(box.h * s, 6);
    expect(p.imgX + (box.x + box.w / 2) * s).toBeCloseTo(cx, 6);
    expect(p.imgY + (box.y + box.h) * s).toBeCloseTo(cy, 6);
  });

  it("rejects unknown ids loudly", () => {
    expect(() => spriteBoxFor(0)).toThrow();
    expect(() => spriteBoxFor(51)).toThrow();
  });
});

describe("yard prop atlas", () => {
  it("exposes the expected prop sets", () => {
    expect(MATERIAL_PALLETS).toHaveLength(6);
    expect(MATERIAL_LOOSE).toHaveLength(6);
    expect(PLANNING_TABLES).toHaveLength(2);
    expect(CREW_WALK).toHaveLength(5);
    expect(CREW_CARRY).toHaveLength(3);
    expect(DRONE_QUADS).toHaveLength(4);
  });

  it("keeps every prop box inside its sheet", () => {
    const inBounds = (box: { x: number; y: number; w: number; h: number }) => {
      expect(box.w).toBeGreaterThan(0);
      expect(box.h).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(1280);
      expect(box.y + box.h).toBeLessThanOrEqual(720);
    };
    for (const box of [
      ...MATERIAL_PALLETS,
      ...MATERIAL_LOOSE,
      ...PLANNING_TABLES,
      ...CREW_WALK,
      ...CREW_CARRY,
      ...DRONE_QUADS,
    ]) {
      inBounds(box);
    }
    inBounds(PROP_BOXES.flatSheet);
    for (const tile of Object.values(GROUND_TILES)) {
      inBounds(tile);
    }
  });

  it("ships the ground kit and anim atlases the renderer references", () => {
    expect(existsSync(join("assets", "city-sprites", GROUND_SHEET.file))).toBe(
      true,
    );
    for (const sheet of Object.values(ANIM_SHEETS)) {
      expect(existsSync(join("assets", "city-sprites", sheet.file))).toBe(true);
    }
  });

  it("keeps anim atlases on a 384px grid with art in the first N cells", () => {
    for (const [name, sheet] of Object.entries(ANIM_SHEETS)) {
      expect(sheet.width / sheet.cols, `${name} cell`).toBe(384);
      expect(sheet.height / sheet.rows, `${name} cell`).toBe(384);
      expect(sheet.frames).toBeGreaterThan(0);
      expect(sheet.frames).toBeLessThanOrEqual(sheet.cols * sheet.rows);
      expect(sheet.fps).toBe(8);
    }
  });

  it("ships the prop sheets the renderer references", () => {
    for (const sheet of Object.values(PROP_SHEETS)) {
      expect(existsSync(join("assets", "city-sprites", sheet.file))).toBe(true);
    }
  });

  it("ships the keyed wild sheets with in-bounds foliage boxes", () => {
    for (const sheet of Object.values(WILD_SHEETS)) {
      expect(existsSync(join("assets", "city-sprites", sheet.file))).toBe(true);
    }
    expect(WILD_TREES.length).toBeGreaterThan(100);
    expect(WILD_BUSHES.length).toBeGreaterThan(20);
    const inWild = (
      sheet: { width: number; height: number },
      box: { x: number; y: number; w: number; h: number },
    ) => {
      expect(box.w).toBeGreaterThan(0);
      expect(box.h).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(sheet.width);
      expect(box.y + box.h).toBeLessThanOrEqual(sheet.height);
    };
    for (const box of WILD_TREES) inWild(WILD_SHEETS.trees, box);
    for (const box of WILD_BUSHES) inWild(WILD_SHEETS.bushes, box);
    inWild(WILD_SHEETS.bushes, WILD_WATER);
  });

  it("sizes prop clips to the requested target width", () => {
    const sheet = PROP_SHEETS.materials;
    const p = propPlacement(sheet, PROP_BOXES.brickPallet, 100, 200, 85);
    expect(p.clipW).toBeCloseTo(85, 6);
    expect(
      p.imgX +
        (PROP_BOXES.brickPallet.x + PROP_BOXES.brickPallet.w / 2) *
          (85 / PROP_BOXES.brickPallet.w),
    ).toBeCloseTo(100, 6);
    expect(
      p.imgY +
        (PROP_BOXES.brickPallet.y + PROP_BOXES.brickPallet.h) *
          (85 / PROP_BOXES.brickPallet.w),
    ).toBeCloseTo(200, 6);
  });
});

describe("civic and HUD kits", () => {
  it("ships restyled civic and HUD sheets with in-bounds frames", () => {
    expect(existsSync(join("assets", "city-sprites", CIVIC_SHEET.file))).toBe(true);
    expect(existsSync(join("assets", "city-sprites", HUD_SHEET.file))).toBe(true);
    for (const [name, box] of Object.entries(CIVIC_SPRITES)) {
      expect(box.w, name).toBeGreaterThan(0);
      expect(box.h, name).toBeGreaterThan(0);
      expect(box.x + box.w, name).toBeLessThanOrEqual(CIVIC_SHEET.width);
      expect(box.y + box.h, name).toBeLessThanOrEqual(CIVIC_SHEET.height);
    }
    for (const [name, box] of Object.entries(HUD_FRAMES)) {
      expect(box.x + box.w, name).toBeLessThanOrEqual(HUD_SHEET.width);
      expect(box.y + box.h, name).toBeLessThanOrEqual(HUD_SHEET.height);
    }
    expect(CIVIC_SPRITES.office.w).toBeGreaterThan(400);
    expect(CIVIC_SPRITES["plant-0"].h).toBeGreaterThan(60);
    expect(CIVIC_SPRITES["road-0"].w).toBeGreaterThan(120);
    expect(CIVIC_SPRITES["bike-0"].w).toBeGreaterThan(100);
    expect(ROAD_STAMP_WIDTH).toBeGreaterThanOrEqual(140);
    expect(BIKE_STAMP_WIDTH).toBeGreaterThanOrEqual(90);
    expect(HUD_FRAMES.plate.w).toBe(250);
    expect(HUD_FRAMES.compass.w).toBe(100);
  });
});
