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
  ODD_STAMP_WIDTH,
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

  it("remaps high-chroma terracotta roofs onto catalog families without flattening the sheet", () => {
    const script = `
from PIL import Image
import colorsys
boxes = {6:(63,244,130,112), 11:(22,364,211,172), 17:(298,545,171,171)}
small = Image.open("assets/city-sprites/buildings-small-01-17-k1.png").convert("RGBA")
px = small.load()

def orange(r,g,b):
    if g > r + 12 and g > b + 8:
        return False
    h,s,v = colorsys.rgb_to_hsv(r/255,g/255,b/255)
    return 10 <= h*360 <= 42 and s >= 0.38 and v >= 0.34 and r > b + 26

def stats(box):
    x0,y0,w,h = box
    n=ora=0
    sr=sg=sb=0
    for y in range(y0,y0+h):
        for x in range(x0,x0+w):
            r,g,b,a = px[x,y]
            if a<16: continue
            n+=1
            sr+=r;sg+=g;sb+=b
            if orange(r,g,b): ora+=1
    return n, ora, sr/n, sg/n, sb/n

n6,o6,r6,g6,b6 = stats(boxes[6])
n17,o17,r17,g17,b17 = stats(boxes[17])
n11,o11,r11,g11,b11 = stats(boxes[11])
families=set()
for y in range(0,small.height,3):
    for x in range(0,small.width,3):
        r,g,b,a = px[x,y]
        if a<16: continue
        if max(r,g,b)-min(r,g,b)>28:
            families.add(int(colorsys.rgb_to_hsv(r/255,g/255,b/255)[0]*8))
print(f"{o6/n6:.4f} {r6-b6:.1f} {g17-r17:.1f} {g11-r11:.1f} {len(families)}")
`;
    const [orange6, warm6, pagodaGreen, houseGreen, families] = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(orange6, "building 6 still has a high-chroma terracotta roof").toBeLessThan(0.05);
    expect(warm6, "building 6 roof still reads orange (R>>B)").toBeLessThan(32);
    expect(pagodaGreen, "pagoda roof was flattened off catalog green").toBeGreaterThan(4);
    expect(houseGreen, "green catalog house roof was flattened").toBeGreaterThan(0);
    expect(families, "catalog roofs collapsed to one hue family").toBeGreaterThanOrEqual(4);
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
    expect(ODD_STAMP_WIDTH["odd-2"], "fence stamp still flyover-thin").toBeGreaterThanOrEqual(200);
    expect(ODD_STAMP_WIDTH["odd-4"], "gate stamp still flyover-thin").toBeGreaterThanOrEqual(190);
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

  it("stamps civic-distinct inland odds, not ChatGPT lot-catalog houses", () => {
    const script = `
from PIL import Image
civic = Image.open("assets/city-sprites/civic-kit-k1.png").convert("RGBA")
large = Image.open("assets/city-sprites/buildings-large-35-50-k1.png").convert("RGBA")
px = civic.load()
lpx = large.load()

def tall_steeples(box):
    x0,y0,w,h = box
    top = y0 + int(h * 0.40)
    cols = []
    for x in range(x0, x0+w):
        dark = 0
        for y in range(y0, top):
            r,g,b,a = px[x,y]
            if a > 16 and (r+g+b)/3 < 70:
                dark += 1
        if dark >= 16:
            cols.append(x)
    if not cols:
        return 0
    groups = 1
    for i in range(1, len(cols)):
        if cols[i] > cols[i-1] + 3:
            groups += 1
    return groups

def stats(box, src=None):
    p = lpx if src == "L" else px
    x0,y0,w,h = box
    n=glass=dark=khaki=cream=0
    fill = w * h
    for y in range(y0, y0+h):
        for x in range(x0, x0+w):
            r,g,b,a = p[x,y]
            if a < 16:
                continue
            n += 1
            luma = (r+g+b)/3
            sat = max(r,g,b) - min(r,g,b)
            if b > r + 18 and b >= g - 4 and sat > 28 and luma < 210:
                glass += 1
            if luma < 90:
                dark += 1
            if r > b + 10 and g > b + 6 and sat < 55 and 70 < luma < 190:
                khaki += 1
            if r > 200 and g > 190 and b > 155 and r > b + 8 and luma > 190:
                cream += 1
    return n, glass, dark, khaki, cream, n / max(fill, 1)

n2,g2,d2,k2,c2,f2 = stats((588, 8, 171, 202))
n3,g3,d3,k3,c3,f3 = stats((767, 8, 144, 139))
n4,g4,d4,k4,c4,f4 = stats((919, 8, 108, 122))
n6,g6,d6,k6,c6,f6 = stats((1208, 319, 159, 157))
nh,gh,dh,kh,ch,fh = stats((436, 8, 144, 125))
nl,gl,dl,kl,cl,fl = stats((765, 4, 70, 172), "L")
print(f"{n2} {g2} {d2} {c2} {f2:.3f} {n3} {g3} {k3} {n4} {g4} {d4} {c4} {f4:.3f} {n6} {g6} {k6} {nh} {gh} {dh} {gl}")
`;
    const [
      n2,
      glass2,
      dark2,
      cream2,
      fill2,
      n3,
      glass3,
      khaki3,
      n4,
      glass4,
      dark4,
      cream4,
      fill4,
      n6,
      glass6,
      khaki6,
      nh,
      glassH,
      darkH,
      catalogGlass,
    ] = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(n2, "odd-2 fence enclosure emptied").toBeGreaterThan(4000);
    expect(glass2, "odd-2 still reads as a catalog glass tower").toBeLessThan(40);
    expect(fill2, "odd-2 still a hairline fence with no flyover mass").toBeGreaterThan(0.35);
    expect(cream2, "odd-2 lost its cream yard infill").toBeGreaterThan(800);
    expect(dark2, "odd-2 lost timber/slate posts").toBeGreaterThan(400);
    expect(n3, "odd-3 parking pad emptied").toBeGreaterThan(2500);
    expect(glass3, "odd-3 still reads as a catalog slab").toBeLessThan(40);
    expect(khaki3, "odd-3 lost its civic parking pad").toBeGreaterThan(4000);
    expect(n4, "odd-4 gate monument emptied").toBeGreaterThan(2000);
    expect(fill4, "odd-4 still stacked hairline rails").toBeGreaterThan(0.35);
    expect(cream4, "odd-4 lost its cream plinth").toBeGreaterThan(400);
    expect(dark4, "odd-4 lost timber posts").toBeGreaterThan(200);
    expect(n6, "odd-6 depot emptied").toBeGreaterThan(2500);
    expect(khaki6, "odd-6 lost its parking+gate depot pad").toBeGreaterThan(4000);
    expect(nh, "city-hall cottage emptied").toBeGreaterThan(2000);
    expect(glassH / nh, "city-hall still reads as a catalog glass hub").toBeLessThan(0.12);
    expect(darkH, "city-hall lost its dark hip roof").toBeGreaterThan(1500);
    expect(catalogGlass, "lot catalog glass tower missing — comparison invalid").toBeGreaterThan(800);
    expect(glass2 + glass3, "inland odds still carry catalog glass").toBeLessThan(catalogGlass * 0.1);
    expect(cream2, "fence and parking should stay different silhouettes").toBeGreaterThan(khaki3 * 0.05);
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
