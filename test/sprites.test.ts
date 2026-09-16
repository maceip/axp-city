import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANIM_SHEETS,
  BIKE_STAMP_WIDTH,
  BUILDING_SHEETS,
  CIVIC_SHEET,
  CIVIC_SPRITES,
  CONSTRUCTION_STAGES,
  CREW_CARRY,
  CREW_WALK,
  DRONE_QUADS,
  GROUND_SHEET,
  GROUND_TILES,
  HUD_FONT,
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
    expect(existsSync(join("assets", "city-sprites", HUD_FONT.file))).toBe(true);
    expect(existsSync(join("assets", "city-sprites", HUD_FONT.xml))).toBe(true);
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
    expect(BIKE_STAMP_WIDTH).toBeGreaterThanOrEqual(180);
    expect(HUD_FRAMES.plate.w).toBe(250);
    expect(HUD_FRAMES.compass.w).toBe(100);
    expect(Object.keys(CONSTRUCTION_STAGES)).toEqual(["grading", "framing", "cladding", "finishing"]);
    expect(CONSTRUCTION_STAGES.grading).toEqual(CIVIC_SPRITES["scaffold-0"]);
    expect(CONSTRUCTION_STAGES.framing).toEqual(CIVIC_SPRITES["scaffold-1"]);
    expect(CONSTRUCTION_STAGES.cladding).toEqual(CIVIC_SPRITES["scaffold-2"]);
    expect(CONSTRUCTION_STAGES.finishing).toEqual(CIVIC_SPRITES["scaffold-3"]);
    expect(CIVIC_SPRITES["scaffold-4"]).toBeUndefined();
    expect(CONSTRUCTION_STAGES.finishing).not.toEqual(CIVIC_SPRITES["bank-office"]);
  });

  it("stamps olive-cream-slate scaffold-0..3 and never the finished $ bank", () => {
    const script = `
from PIL import Image
civic = Image.open("assets/city-sprites/civic-kit-k1.png").convert("RGBA")
boxes = [(1142, 8, 87, 73), (1237, 8, 75, 99), (1320, 8, 88, 110), (1416, 8, 95, 110)]
bank = (1035, 8, 99, 114)
px = civic.load()
pale = dollar = n = 0
sr = sg = sb = 0
for x0, y0, w, h in boxes:
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            n += 1
            sr += r; sg += g; sb += b
            if (r + g + b) / 3 > 220:
                pale += 1
            if g > 90 and r < 80 and b < 90:
                dollar += 1
br = bg = bb = bn = 0
for y in range(bank[1], bank[1] + bank[3]):
    for x in range(bank[0], bank[0] + bank[2]):
        r, g, b, a = px[x, y]
        if a < 16:
            continue
        bn += 1
        if b > r + 25 and b > g + 8:
            bb += 1
        if g > 90 and r < 80 and b < 90:
            bg += 1
print(f"{sr/n:.1f} {sg/n:.1f} {sb/n:.1f} {pale/n:.3f} {dollar} {bg} {bb}")
`;
    const [mr, mg, mb, paleFrac, dollar, bankGreen, bankBlue] = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(paleFrac, `scaffolds still ghost-white (${mr},${mg},${mb})`).toBeLessThan(0.12);
    expect(mr - mb, "scaffolds should sit in cream, not cool grey").toBeGreaterThan(8);
    expect(dollar, "scaffold frames must not include the $ bank mark").toBe(0);
    expect(bankGreen, "bank-office lost its $ mark").toBeGreaterThan(4);
    expect(bankBlue, "bank-office is the finished civic, not a stage").toBeGreaterThan(10);
  });

  it("crushes Jane church/villa odds onto catalog cream-slate, not lemon Realty yellow", () => {
    const script = `
from PIL import Image
civic = Image.open("assets/city-sprites/civic-kit-k1.png").convert("RGBA")
boxes = [(588, 8, 171, 202), (1208, 319, 159, 157)]
px = civic.load()
n = yellow = satish = 0
for x0, y0, w, h in boxes:
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            n += 1
            sat = max(r, g, b) - min(r, g, b)
            if sat > 70:
                satish += 1
            if r > 180 and g > 150 and b < 120:
                yellow += 1
print(f"{n} {yellow} {satish/n:.3f}")
`;
    const [opaque, yellow, satFrac] = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(opaque, "church/villa frames emptied").toBeGreaterThan(20000);
    expect(yellow, "Jane lemon walls still stamped on odd-2/odd-6").toBe(0);
    expect(satFrac, "church/villa still high-sat cartoon Jane").toBeLessThan(0.10);
  });

  it("keeps bike stamps and HUD plaques on the olive-cream-slate catalog", () => {
    const script = `
from PIL import Image
civic = Image.open("assets/city-sprites/civic-kit-k1.png").convert("RGBA")
hud = Image.open("assets/city-sprites/hud-kit-k1.png").convert("RGB")
bx, by, bw, bh = 320, 640, 120, 70
lime = n = 0
sr = sg = sb = 0
px = civic.load()
for y in range(by, by + bh):
    for x in range(bx, bx + bw):
        r, g, b, a = px[x, y]
        if a < 40:
            continue
        n += 1
        sr += r; sg += g; sb += b
        if g > r + 28 and g > b + 20 and (max(r, g, b) - min(r, g, b)) > 55:
            lime += 1
mr, mg, mb = sr / n, sg / n, sb / n
pr, pg, pb = hud.getpixel((20, 20))
print(f"{mr:.1f} {mg:.1f} {mb:.1f} {lime/n:.3f} {pr} {pg} {pb}")
`;
    const [mr, mg, mb, limeFrac, pr, pg, pb] = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(limeFrac, `bike-0 still has neon lime (${mr},${mg},${mb})`).toBeLessThan(0.08);
    expect(mg - mr, "bike-0 green channel still dominates red").toBeLessThan(18);
    expect(Math.abs(pr - pg), "HUD plate still reads as raw walnut, not olive timber").toBeLessThan(20);
    expect(pb, "HUD plate should stay in the cream-slate family").toBeGreaterThan(40);
  });

  it("restyles wild-tree canopy onto the same olive catalog as civic plants", () => {
    const script = `
from PIL import Image
trees = Image.open("assets/city-sprites/v8-wild-trees-k1.png").convert("RGBA")
civic = Image.open("assets/city-sprites/civic-kit-k1.png").convert("RGBA")
px = trees.load()
n = lime = 0
sr = sg = sb = 0
for y in range(0, trees.height, 4):
    for x in range(0, trees.width, 4):
        r, g, b, a = px[x, y]
        if a < 40:
            continue
        n += 1
        sr += r; sg += g; sb += b
        if g > r + 28 and g > b + 20 and (max(r, g, b) - min(r, g, b)) > 55:
            lime += 1
cpx = civic.load()
cn = clr = clg = clb = 0
for y in range(319, 420, 2):
    for x in range(1375, 1449, 2):
        r, g, b, a = cpx[x, y]
        if a < 40:
            continue
        cn += 1
        clr += r; clg += g; clb += b
print(f"{sr/n:.1f} {sg/n:.1f} {sb/n:.1f} {lime/n:.3f} {clr/cn:.1f} {clg/cn:.1f} {clb/cn:.1f}")
`;
    const [mr, mg, mb, limeFrac, cr, cg, cb] = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(limeFrac, `wild trees still neon (${mr},${mg},${mb})`).toBeLessThan(0.05);
    expect(mg - mr, "wild canopy still much greener than civic plants").toBeLessThan(20);
    expect(Math.abs(mg - cg), "wild vs civic foliage still in different families").toBeLessThan(28);
    expect(mr, "wild canopy still too dark/chartreuse versus civic plants").toBeGreaterThan(90);
  });

  it("ships a baseline-aligned HUD bitmap font so labels cannot double on SwiftShader", () => {
    const script = `
import xml.etree.ElementTree as ET
from PIL import Image
xml = ET.parse("assets/city-sprites/hud-font-k1.xml")
info = xml.find("info")
chars = {int(c.attrib["id"]): c.attrib for c in xml.find("chars")}
sheet = Image.open("assets/city-sprites/hud-font-k1.png")
print(info.attrib["face"])
print(info.attrib["size"])
print(sheet.size[0], sheet.size[1])
print(chars[65]["yoffset"], chars[97]["yoffset"], chars[103]["height"])
print(int(8722 in chars))
`;
    const [face, size, dims, offsets, hasMinus] = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    const [sw, sh] = dims.split(/\s+/).map(Number);
    const [aY, ay, gh] = offsets.split(/\s+/).map(Number);
    expect(face).toBe("hud-ink");
    expect(Number(size)).toBe(32);
    expect(sw).toBe(HUD_FONT.width);
    expect(sh).toBe(HUD_FONT.height);
    expect(aY, "capital yoffset should sit below the line top").toBeGreaterThanOrEqual(0);
    expect(aY).toBeLessThan(16);
    expect(ay, "lowercase should sit lower than capitals").toBeGreaterThan(aY);
    expect(gh, "g must keep its descender").toBeGreaterThan(ay);
    expect(Number(hasMinus), "minus sign used by zoom-out is missing from the atlas").toBe(1);
    expect(existsSync(join("assets", "city-sprites", HUD_FONT.file))).toBe(true);
  });
});
