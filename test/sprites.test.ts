import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANIM_SHEETS,
  BUILDING_SHEETS,
  CREW_CARRY,
  CREW_WALK,
  DRONE_QUADS,
  GROUND_SHEET,
  GROUND_TILES,
  MATERIAL_LOOSE,
  MATERIAL_PALLETS,
  PLANNING_TABLES,
  PROP_BOXES,
  PROP_SHEETS,
  propPlacement,
  sheetForBand,
  spriteBoxFor,
  spritePlacement,
  stamper,
} from "../src/render/sprites.js";

describe("building sprite atlas", () => {
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
    expect(existsSync(join("assets", "city-sprites", GROUND_SHEET.file))).toBe(true);
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

  it("sizes prop clips to the requested target width", () => {
    const sheet = PROP_SHEETS.materials;
    const p = propPlacement(sheet, PROP_BOXES.brickPallet, 100, 200, 85);
    expect(p.clipW).toBeCloseTo(85, 6);
    expect(p.imgX + (PROP_BOXES.brickPallet.x + PROP_BOXES.brickPallet.w / 2) * (85 / PROP_BOXES.brickPallet.w)).toBeCloseTo(100, 6);
    expect(p.imgY + (PROP_BOXES.brickPallet.y + PROP_BOXES.brickPallet.h) * (85 / PROP_BOXES.brickPallet.w)).toBeCloseTo(200, 6);
  });

  it("mints unique clip ids per stamp", () => {
    const stamp = stamper(3);
    const sheet = PROP_SHEETS.drones;
    const a = stamp("f.png", sheet, PROP_BOXES.quadScout, 0, 0, 10, false);
    const b = stamp("f.png", sheet, PROP_BOXES.quadScout, 0, 0, 10, false);
    expect(a).toContain("clip-lot-3-0");
    expect(b).toContain("clip-lot-3-1");
  });
});
