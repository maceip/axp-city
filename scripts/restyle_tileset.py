#!/usr/bin/env python3
"""Filter, restyle, and atlas fetched/attached tilesets into the AXP city vibe.

Raw packs mix FarmVille pixel interiors, SimCity 2000, cartoon HUD, and
photoreal plants. This script keeps only isometric pieces that can be shifted
onto the existing construction-city palette (olive ground, cream/slate walls,
gold HUD), keys their backgrounds, and writes measured atlases the Phaser
renderer stamps. Repo lots do not receive raw mismatched art.
"""

from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "city-sprites"
MANIFEST = ROOT / "scripts" / "generated"
SRC1 = Path("/tmp/tilesets/src1/untitled folder")
SRC2 = Path("/tmp/tilesets/src2/untitled folder 2")
SRC3 = Path("/tmp/tilesets/src3/untitled folder 3")
ATTACHED = Path(
    "/home/ubuntu/.cursor/projects/workspace/assets/c3cd0925-d6f1-4b85-b160-53bffbc2ba9e.png"
)
HQ = Path("/tmp/tilesets/CENTER_OF_MAP_HQ.png")

# Existing city walls/roofs sit in a muted olive-cream-slate range.
TARGET_SAT = 0.72
GOLD = (246, 221, 145)
FOREST = (21, 37, 32)
INK = (242, 239, 226)


def open_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def key_color(im: Image.Image, pred, grow: int = 1) -> Image.Image:
    """Clear alpha for pixels matching pred, with a small morphological grow."""
    px = im.load()
    w, h = im.size
    drop = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or pred(r, g, b):
                drop[y * w + x] = 1
    if grow:
        nxt = bytearray(drop)
        for y in range(h):
            for x in range(w):
                if not drop[y * w + x]:
                    continue
                for dy in range(-grow, grow + 1):
                    for dx in range(-grow, grow + 1):
                        xx, yy = x + dx, y + dy
                        if 0 <= xx < w and 0 <= yy < h:
                            nxt[yy * w + xx] = 1
        drop = nxt
    out = im.copy()
    opx = out.load()
    for y in range(h):
        for x in range(w):
            if drop[y * w + x]:
                opx[x, y] = (0, 0, 0, 0)
    return out


def key_near_white(im: Image.Image, thresh: int = 238) -> Image.Image:
    return key_color(im, lambda r, g, b: min(r, g, b) >= thresh and abs(r - g) < 18 and abs(g - b) < 18, grow=1)


def key_teal(im: Image.Image) -> Image.Image:
    return key_color(
        im,
        lambda r, g, b: g > 90 and b > 90 and r < 90 and (g + b) / 2 - r > 50,
        grow=2,
    )


def key_pink(im: Image.Image) -> Image.Image:
    return key_color(
        im,
        lambda r, g, b: r > 180 and b > 140 and g < 200 and r - g > 20,
        grow=1,
    )


def key_mauve(im: Image.Image) -> Image.Image:
    return key_color(
        im,
        lambda r, g, b: 90 < r < 170 and 80 < g < 150 and 90 < b < 160 and abs(r - g) < 35,
        grow=1,
    )


def key_black(im: Image.Image, thresh: int = 18) -> Image.Image:
    return key_color(im, lambda r, g, b: max(r, g, b) <= thresh, grow=0)


def restyle(im: Image.Image, sat: float = TARGET_SAT, contrast: float = 1.04) -> Image.Image:
    """Compress saturation toward the catalog's muted isometric look."""
    rgb = im.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(sat)
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    rgb = ImageEnhance.Color(rgb).enhance(0.96)
    out = rgb.convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out


def trim(im: Image.Image, pad: int = 2) -> Image.Image:
    alpha = im.split()[-1]
    bbox = alpha.getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(im.width, x1 + pad), min(im.height, y1 + pad)
    return im.crop((x0, y0, x1, y1))


def components(im: Image.Image, min_px: int = 80) -> list[tuple[int, int, int, int, Image.Image]]:
    """Connected opaque blobs as (x, y, w, h, cropped RGBA)."""
    alpha = im.split()[-1]
    w, h = im.size
    data = alpha.tobytes()
    seen = bytearray(w * h)
    blobs: list[tuple[int, int, int, int, Image.Image]] = []
    for i, a in enumerate(data):
        if a < 12 or seen[i]:
            continue
        q = deque([i])
        seen[i] = 1
        pix = [i]
        while q:
            j = q.popleft()
            x, y = j % w, j // w
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h:
                    k = yy * w + xx
                    if not seen[k] and data[k] >= 12:
                        seen[k] = 1
                        q.append(k)
                        pix.append(k)
        if len(pix) < min_px:
            continue
        xs = [p % w for p in pix]
        ys = [p // w for p in pix]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        blobs.append((x0, y0, x1 - x0 + 1, y1 - y0 + 1, im.crop((x0, y0, x1 + 1, y1 + 1))))
    blobs.sort(key=lambda b: (b[1], b[0]))
    return blobs


def scale_to(im: Image.Image, max_w: int, max_h: int) -> Image.Image:
    if im.width <= max_w and im.height <= max_h:
        return im
    s = min(max_w / im.width, max_h / im.height)
    nw, nh = max(1, int(im.width * s)), max(1, int(im.height * s))
    return im.resize((nw, nh), Image.Resampling.LANCZOS)


def outline(im: Image.Image, color=(40, 48, 42, 220)) -> Image.Image:
    """1px dark outline for sprites that arrived without one."""
    a = im.split()[-1]
    edge = a.filter(ImageFilter.FIND_EDGES)
    ring = Image.new("RGBA", im.size, (0, 0, 0, 0))
    rp = ring.load()
    ep = edge.load()
    for y in range(im.height):
        for x in range(im.width):
            if ep[x, y] > 40:
                rp[x, y] = color
    return Image.alpha_composite(ring, im)


def cell_paste(sheet: Image.Image, sprite: Image.Image, cx: int, cy: int, cw: int, ch: int) -> dict:
    """Park a sprite on the bottom-center of a cell; return measured content box."""
    spr = scale_to(sprite, cw - 8, ch - 8)
    x = cx + (cw - spr.width) // 2
    y = cy + ch - spr.height - 4
    sheet.alpha_composite(spr, (x, y))
    return {"x": x, "y": y, "w": spr.width, "h": spr.height}


def grid_sheet(sprites: list[Image.Image], cols: int, cell_w: int, cell_h: int, width: int, height: int):
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    boxes = []
    for i, spr in enumerate(sprites):
        col, row = i % cols, i // cols
        boxes.append(cell_paste(sheet, spr, col * cell_w, row * cell_h, cell_w, cell_h))
    return sheet, boxes


def slice_grid_rows(im: Image.Image, bands: list[tuple[int, int]], n: int, min_px: int) -> list[list[Image.Image]]:
    """Within each (y0,y1) band, take the n left-to-right components."""
    rows = []
    for y0, y1 in bands:
        band = im.crop((0, y0, im.width, y1))
        blobs = [b for b in components(band, min_px=min_px) if b[2] > 28 and b[3] > 28]
        blobs.sort(key=lambda b: b[0])
        # Merge overlapping (labels sitting on buildings) by preferring taller blobs.
        picked: list[tuple] = []
        for b in blobs:
            if any(abs(b[0] - p[0]) < 40 for p in picked):
                continue
            picked.append(b)
        picked = picked[:n]
        rows.append([trim(b[4]) for b in picked])
    return rows


def jane_houses(hud: Image.Image) -> list[Image.Image]:
    """Top cartoon houses, restyled toward catalog saturation."""
    top = hud.crop((0, 0, hud.width, 250))
    keyed = key_teal(top)
    blobs = components(keyed, min_px=400)
    houses = []
    for x, y, w, h, crop in blobs:
        if w < 40 or h < 40 or w > 180 or h > 140:
            continue
        if h / max(w, 1) < 0.55:
            continue
        houses.append(outline(restyle(trim(crop), sat=0.62, contrast=1.08)))
    return houses[:24]


def extract_construction(sheet: Image.Image, bg: str) -> list[Image.Image]:
    keyed = key_mauve(sheet) if bg == "mauve" else key_teal(sheet) if bg == "teal" else key_near_white(sheet)
    # Left column of construction stages.
    left = keyed.crop((0, 0, min(220, keyed.width), keyed.height))
    blobs = components(left, min_px=250)
    blobs.sort(key=lambda b: b[1])
    stages = []
    for b in blobs:
        if b[2] < 40 or b[3] < 40:
            continue
        # Finished $ bank sits at the bottom of the attached column.
        if b[1] > keyed.height * 0.72:
            continue
        stages.append(restyle(trim(b[4]), sat=0.7))
    return stages


def extract_finished_column(sheet: Image.Image, bg: str) -> Image.Image | None:
    keyed = key_mauve(sheet) if bg == "mauve" else key_teal(sheet)
    right = keyed.crop((int(keyed.width * 0.35), 0, keyed.width, keyed.height))
    blobs = components(right, min_px=800)
    blobs.sort(key=lambda b: b[2] * b[3], reverse=True)
    for b in blobs:
        if b[3] > 80 and b[2] > 70:
            return restyle(trim(b[4]), sat=0.68)
    return None


def extract_styleui_plants(im: Image.Image) -> list[Image.Image]:
    keyed = key_pink(im)
    # Bottom tree strip is the closest match to catalog trees.
    bottom = keyed.crop((0, int(im.height * 0.72), im.width, im.height))
    blobs = components(bottom, min_px=120)
    plants = []
    for b in blobs:
        if 20 < b[2] < 140 and 24 < b[3] < 160:
            plants.append(restyle(trim(b[4]), sat=0.78))
    return plants[:40]


def extract_fruit_trees(im: Image.Image) -> list[Image.Image]:
    keyed = key_near_white(im, thresh=245)
    keyed = key_black(keyed, thresh=12)
    mid = keyed.crop((80, 0, im.width - 20, int(im.height * 0.62)))
    blobs = components(mid, min_px=180)
    trees = []
    for b in blobs:
        if 18 < b[2] < 90 and 40 < b[3] < 140:
            trees.append(restyle(trim(b[4]), sat=0.7))
    return trees[:24]


def extract_bike_road() -> list[Image.Image]:
    tiles = []
    for name, pred in (
        ("tilesets-bikepath.png", lambda r, g, b: max(r, g, b) < 20),
        ("tilesets-road.png", lambda r, g, b: max(r, g, b) < 20),
        ("tilesets-terrain.png", lambda r, g, b: max(r, g, b) < 20),
    ):
        path = SRC1 / name
        if not path.exists():
            continue
        keyed = key_color(open_rgba(path), pred, grow=0)
        blobs = components(keyed, min_px=40)
        for b in blobs:
            if 16 < b[2] < 90 and 10 < b[3] < 70:
                tiles.append(restyle(trim(b[4]), sat=0.55, contrast=1.1))
    return tiles[:48]


def extract_odd_buildings() -> list[Image.Image]:
    odd: list[Image.Image] = []
    # Jane's map windmill / waterfall / trees — keep windmill + trees, drop interiors.
    maps = SRC2 / "PC _ Computer - Jane's Realty - Map - Map Elements.png"
    if maps.exists():
        keyed = key_teal(open_rgba(maps))
        left = keyed.crop((0, 0, 280, keyed.height))
        blobs = components(left, min_px=400)
        blobs.sort(key=lambda b: b[1])
        if blobs:
            odd.append(restyle(trim(blobs[0][4]), sat=0.65))  # windmill
        trees = keyed.crop((280, 420, keyed.width, keyed.height))
        for b in components(trees, min_px=200)[:8]:
            if b[3] > 30:
                odd.append(restyle(trim(b[4]), sat=0.75))
    for rel in (
        "PC _ Computer - Jane's Realty - Buildings - Bank.png",
        "PC _ Computer - Jane's Realty - Buildings - Store.png",
        "PC _ Computer - Jane's Realty - Buildings - City Hall.png",
        "PC _ Computer - Jane's Realty - Buildings - Church.png",
        "PC _ Computer - Jane's Realty - Buildings - Repair Station.png",
        "PC _ Computer - Jane's Realty - Buildings - Beach Cottage.png",
        "PC _ Computer - Jane's Realty - Buildings - Spanish Villa.png",
        "PC _ Computer - Jane's Realty - Buildings - Norwood House.png",
    ):
        path = SRC2 / rel
        if not path.exists():
            continue
        finished = extract_finished_column(open_rgba(path), "teal")
        if finished:
            odd.append(finished)
    # Attached bank.
    if ATTACHED.exists():
        bank = extract_finished_column(open_rgba(ATTACHED), "mauve")
        if bank:
            odd.append(bank)
    return odd


def largest_opaque(im: Image.Image, min_w: int = 50, min_h: int = 50) -> Image.Image | None:
    blobs = [b for b in components(im, min_px=200) if b[2] >= min_w and b[3] >= min_h]
    if not blobs:
        return None
    blobs.sort(key=lambda b: b[2] * b[3], reverse=True)
    return trim(blobs[0][4])


def extract_chatgpt_grid() -> dict[str, list[Image.Image]]:
    """The 10×3 S/M/L catalog — already in the city isometric vibe."""
    path = SRC2 / "ChatGPT Image Sep 16, 2026, 08_01_22 AM (2).png"
    im = open_rgba(path)
    w, _h = im.size
    cw = w / 10
    # Measured content bands on the 1536×1024 sheet (labels sit above each row).
    bands = {"S": (200, 330), "M": (370, 590), "L": (630, 980)}
    rows: dict[str, list[Image.Image]] = {k: [] for k in bands}
    for band, (y0, y1) in bands.items():
        for col in range(10):
            cell = im.crop((int(col * cw) + 4, y0, int((col + 1) * cw) - 2, y1))
            keyed = key_near_white(cell, thresh=236)
            spr = largest_opaque(keyed, 55, 55)
            if spr:
                rows[band].append(restyle(spr, sat=0.78, contrast=1.05))
    families = []
    for name in sorted(SRC2.glob("ChatGPT Image Sep 16, 2026, 08_01_46*.png")) + sorted(
        SRC2.glob("ChatGPT Image Sep 16, 2026, 08_01_47*.png")
    ):
        fim = key_near_white(open_rgba(name), thresh=238)
        blobs = [b for b in components(fim, min_px=1200) if b[2] > 80 and b[3] > 70]
        blobs.sort(key=lambda b: b[0])
        trio = [restyle(trim(b[4]), sat=0.78) for b in blobs[:3]]
        if trio:
            families.append(trio)
    return {"S": rows["S"], "M": rows["M"], "L": rows["L"], "families": families}


def original_catalog(band: str) -> list[Image.Image]:
    files = {
        "S": OUT / "buildings-small-01-17-k1.png",
        "M": OUT / "buildings-medium-18-34-k1.png",
        "L": OUT / "buildings-large-35-50-k1.png",
    }
    im = open_rgba(files[band])
    blobs = [b for b in components(im, min_px=400) if b[2] > 70 and b[3] > 70]
    # Skip the title text blob on the small sheet.
    blobs = [b for b in blobs if b[1] > 40 or band != "S"]
    blobs.sort(key=lambda b: (b[1] // 80, b[0]))
    return [trim(b[4]) for b in blobs]


def recolor_gold_widget(im: Image.Image) -> Image.Image:
    """Shift Jane's orange chrome onto forest plates with gold trim."""
    keyed = key_teal(im)
    px = keyed.load()
    for y in range(keyed.height):
        for x in range(keyed.width):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            if r > 170 and g > 120 and b < 110:
                px[x, y] = (GOLD[0], GOLD[1], GOLD[2], a)
            elif r > 140 and g > 90 and b < 90:
                px[x, y] = (36, 58, 48, a)
            elif r > 90 and g > 55 and b < 70:
                px[x, y] = (21, 37, 32, a)
    return restyle(keyed, sat=0.8, contrast=1.04)


def hud_kit(hud: Image.Image) -> tuple[Image.Image, dict]:
    """Forest/gold HUD kit. Jane's widgets are recolored; map chrome is dropped."""
    kit = Image.new("RGBA", (1024, 768), (0, 0, 0, 0))
    boxes: dict = {}
    draw = ImageDraw.Draw(kit)

    def forest_panel(name, x, y, w, h, r=12):
        draw.rounded_rectangle((x, y, x + w, y + h), r, fill=(21, 37, 32, 235), outline=GOLD + (210,), width=2)
        draw.rounded_rectangle((x + 3, y + 3, x + w - 3, y + h - 3), max(4, r - 4), outline=(80, 110, 90, 80), width=1)
        boxes[name] = {"x": x, "y": y, "w": w, "h": h}

    forest_panel("plate", 8, 8, 250, 78, 10)
    forest_panel("status", 270, 8, 320, 62, 10)
    forest_panel("mass", 600, 8, 186, 44, 10)
    forest_panel("card", 8, 100, 330, 260, 12)
    forest_panel("census", 8, 380, 900, 120, 8)
    forest_panel("minimap", 350, 100, 200, 140, 10)
    forest_panel("toast", 8, 520, 360, 48, 8)
    forest_panel("btn", 580, 100, 92, 36, 8)
    forest_panel("btn-wide", 580, 148, 140, 36, 8)
    forest_panel("btn-sq", 580, 196, 46, 46, 8)
    forest_panel("dpad", 740, 100, 150, 150, 12)
    # Compass disc.
    draw.ellipse((910, 8, 1010, 108), fill=(21, 37, 32, 235), outline=GOLD + (220,), width=2)
    draw.polygon([(960, 28), (972, 52), (960, 48)], fill=GOLD)
    boxes["compass"] = {"x": 910, "y": 8, "w": 100, "h": 100}
    # Recolored Jane's pills — isolated, not the map chrome.
    pills = recolor_gold_widget(hud.crop((8, 448, 900, 520)))
    kit.alpha_composite(pills.resize((880, 64), Image.Resampling.LANCZOS), (8, 580))
    boxes["pills"] = {"x": 8, "y": 580, "w": 880, "h": 64}
    bars = recolor_gold_widget(hud.crop((250, 520, 900, 600)))
    kit.alpha_composite(bars.resize((400, 48), Image.Resampling.LANCZOS), (8, 660))
    boxes["bars"] = {"x": 8, "y": 660, "w": 400, "h": 48}
    draw.rounded_rectangle((430, 668, 730, 684), 4, fill=(42, 47, 44, 255))
    draw.rounded_rectangle((430, 668, 590, 684), 4, fill=GOLD)
    boxes["mass-track"] = {"x": 430, "y": 668, "w": 300, "h": 16}
    boxes["mass-fill"] = {"x": 430, "y": 668, "w": 160, "h": 16}
    return kit, boxes


def is_fragment(spr: Image.Image) -> bool:
    if spr.width < 70 or spr.height < 70:
        return True
    if spr.width * spr.height < 6000:
        return True
    return False


def is_gray_pad(spr: Image.Image) -> bool:
    """Parking diamonds and empty pavement — not buildings."""
    px = spr.load()
    n = gray = 0
    for y in range(0, spr.height, 2):
        for x in range(0, spr.width, 2):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            n += 1
            if max(r, g, b) - min(r, g, b) < 22 and 70 < max(r, g, b) < 210:
                gray += 1
    return n > 40 and gray / n > 0.55


def extract_last_building(path: Path, bg: str) -> Image.Image | None:
    """Finished stage sits at the bottom of Jane's construction sheets; skip pads."""
    if not path.exists():
        return None
    keyed = key_mauve(open_rgba(path)) if bg == "mauve" else key_teal(open_rgba(path))
    # City Hall has a parking diamond on the right; keep the building column.
    if keyed.width > 240:
        keyed = keyed.crop((0, 0, 220, keyed.height))
    bottom = keyed.crop((0, int(keyed.height * 0.55), keyed.width, keyed.height))
    blobs = [b for b in components(bottom, min_px=700) if b[2] > 70 and b[3] > 80]
    blobs.sort(key=lambda b: b[2] * b[3], reverse=True)
    for b in blobs:
        spr = trim(b[4])
        if is_gray_pad(spr) or is_fragment(spr):
            continue
        return restyle(spr, sat=0.66, contrast=1.06)
    return extract_finished_column(open_rgba(path), bg)


GROUND_CROPS = {
    "plant-0": (49, 588, 74, 101),
    "plant-1": (181, 588, 73, 101),
    "plant-2": (314, 582, 61, 107),
    "plant-3": (442, 584, 57, 105),
    "plant-5": (547, 612, 104, 76),
    "road-0": (26, 182, 146, 96),
    "road-1": (190, 181, 144, 97),
}


def write_civic_and_hud() -> tuple[dict, dict]:
    """Rebuild civic + HUD kits only. Building catalogs stay as already restyled."""
    civic = Image.new("RGBA", (1536, 1024), (0, 0, 0, 0))
    civic_boxes: dict[str, dict] = {}
    cursor_x, cursor_y, row_h = 8, 8, 0

    def place(name: str, spr: Image.Image, mw=220, mh=220):
        nonlocal cursor_x, cursor_y, row_h
        spr = scale_to(trim(spr), mw, mh)
        if spr.width < 8 or spr.height < 8:
            return
        if cursor_x + spr.width + 8 > civic.width:
            cursor_x = 8
            cursor_y += row_h + 8
            row_h = 0
        civic.alpha_composite(spr, (cursor_x, cursor_y))
        civic_boxes[name] = {"x": cursor_x, "y": cursor_y, "w": spr.width, "h": spr.height}
        cursor_x += spr.width + 8
        row_h = max(row_h, spr.height)

    hq_path = HQ if HQ.exists() else SRC2 / "CENTER_OF_MAP_HQ.webp"
    if hq_path.exists():
        hq = open_rgba(hq_path)
        hq = key_color(
            hq,
            lambda r, g, b: min(r, g, b) >= 220 and abs(r - g) < 12 and abs(g - b) < 12,
            grow=2,
        )
        office = largest_opaque(hq, 200, 160)
        if office:
            place("office", restyle(office, sat=0.74), 420, 320)

    hall = extract_last_building(SRC2 / "PC _ Computer - Jane's Realty - Buildings - City Hall.png", "teal")
    if hall:
        place("city-hall", hall, 200, 200)
    church = extract_last_building(SRC2 / "PC _ Computer - Jane's Realty - Buildings - Church.png", "teal")
    if church:
        place("odd-2", church, 180, 220)
    store = extract_last_building(SRC2 / "PC _ Computer - Jane's Realty - Buildings - Store.png", "teal")
    if store and not is_gray_pad(store) and not is_fragment(store) and store.height > 90:
        place("odd-3", store, 180, 200)
    maps = SRC2 / "PC _ Computer - Jane's Realty - Map - Map Elements.png"
    if maps.exists():
        mill = key_teal(open_rgba(maps).crop((6, 6, 118, 128)))
        mill = key_color(mill, lambda r, g, b: g > r + 18 and g > b + 12 and g > 70, grow=1)
        mill = trim(mill)
        if mill.getbbox() and mill.height > 50 and not is_gray_pad(mill):
            place("odd-4", restyle(mill, sat=0.62), 160, 160)

    if ATTACHED.exists():
        att = open_rgba(ATTACHED)
        bank = extract_last_building(ATTACHED, "mauve")
        if bank:
            place("bank-office", bank, 180, 200)
        # First five left-column stages only (pad → posts → roof → cladding →
        # unfinished shell). The finished $ bank is bank-office, not a scaffold.
        for i, st in enumerate(extract_construction(att, "mauve")[:5]):
            if st.width >= 40 and st.height >= 40:
                place(f"scaffold-{i}", st, 140, 180)
        park_crop = att.crop((148, 208, 352, 418))
        park_crop = key_color(
            park_crop,
            lambda r, g, b: (g > 95 and b > 95 and r < 95) or (min(r, g, b) > 200 and abs(r - g) < 10),
            grow=0,
        )
        park_crop = trim(park_crop)
        if park_crop.getbbox() and park_crop.width > 80:
            place("parking", restyle(park_crop, sat=0.58), 200, 180)
        for i in range(6):
            y0 = i * 70
            gate = att.crop((362, y0, 518, y0 + 68))
            gate = key_color(gate, lambda r, g, b: max(r, g, b) < 28 or (g > 90 and b > 90 and r < 90), grow=0)
            gate = trim(gate)
            if gate.getbbox() and gate.width > 40 and gate.height > 20:
                place(f"gate-{i}", restyle(gate, sat=0.65), 160, 70)

    villa = extract_last_building(SRC2 / "PC _ Computer - Jane's Realty - Buildings - Spanish Villa.png", "teal")
    if villa and not is_gray_pad(villa) and villa.height > 90:
        place("odd-6", villa, 180, 200)

    ground = OUT / "v5-ground-tiles-kit-k1.png"
    if ground.exists():
        g = open_rgba(ground)
        for name, (x, y, w, h) in GROUND_CROPS.items():
            crop = trim(g.crop((x, y, x + w, y + h)))
            if crop.getbbox():
                place(name, crop, 90 if name.startswith("plant") else 72, 110 if name.startswith("plant") else 48)

    for i, tile in enumerate(extract_bike_road()[:8]):
        if tile.width < 20:
            continue
        # Keep iso diamonds; drop tiny specks and photoreal leftovers.
        if tile.height > 70:
            continue
        place(f"bike-{i}", tile, 72, 42)

    civic.save(OUT / "civic-kit-k1.png")

    hud_src = SRC2 / "PC _ Computer - Jane's Realty - Interface - HUD Graphics.png"
    kit, hud_boxes = hud_kit(open_rgba(hud_src))
    kit.save(OUT / "hud-kit-k1.png")
    return civic_boxes, hud_boxes


def fill_band(needed: int, primary: list[Image.Image], *pools: list[Image.Image]) -> list[Image.Image]:
    out = []
    seen = set()
    for pool in (primary, *pools):
        for spr in pool:
            if is_fragment(spr):
                continue
            key = (spr.width, spr.height, spr.resize((8, 8)).tobytes())
            if key in seen:
                continue
            seen.add(key)
            out.append(spr)
            if len(out) >= needed:
                return out
    i = 0
    while len(out) < needed and out:
        extra = ImageEnhance.Color(out[i % len(out)].convert("RGB")).enhance(0.8 + (i % 5) * 0.07)
        e = extra.convert("RGBA")
        e.putalpha(out[i % len(out)].split()[-1])
        out.append(e)
        i += 1
    return out[:needed]


def main() -> None:
    MANIFEST.mkdir(parents=True, exist_ok=True)
    gpt = extract_chatgpt_grid()
    orig_s, orig_m, orig_l = original_catalog("S"), original_catalog("M"), original_catalog("L")
    houses = jane_houses(open_rgba(SRC2 / "PC _ Computer - Jane's Realty - Interface - HUD Graphics.png"))
    families_s, families_m, families_l = [], [], []
    for trio in gpt["families"]:
        ordered = sorted(trio, key=lambda im: im.width * im.height)
        if len(ordered) >= 1:
            families_s.append(ordered[0])
        if len(ordered) >= 2:
            families_m.append(ordered[1] if len(ordered) > 1 else ordered[0])
        if len(ordered) >= 3:
            families_l.append(ordered[-1])

    small = fill_band(17, [restyle(s) for s in gpt["S"]], families_s, houses, orig_s)
    medium = fill_band(17, [restyle(s) for s in gpt["M"]], families_m, orig_m)
    large = fill_band(16, [restyle(s) for s in gpt["L"]], families_l, orig_l)

    s_sheet, s_boxes = grid_sheet(small, 5, 256, 180, 1280, 720)
    m_sheet, m_boxes = grid_sheet(medium, 5, 256, 180, 1280, 720)
    l_sheet, l_boxes = grid_sheet(large, 4, 320, 180, 1280, 720)
    s_sheet.save(OUT / "buildings-small-01-17-k1.png")
    m_sheet.save(OUT / "buildings-medium-18-34-k1.png")
    l_sheet.save(OUT / "buildings-large-35-50-k1.png")

    building_boxes = {}
    for i, box in enumerate(s_boxes, 1):
        building_boxes[i] = box
    for i, box in enumerate(m_boxes, 18):
        building_boxes[i] = box
    for i, box in enumerate(l_boxes, 35):
        building_boxes[i] = box

    civic_boxes, hud_boxes = write_civic_and_hud()

    manifest = {
        "buildings": building_boxes,
        "civic": civic_boxes,
        "hud": hud_boxes,
        "sheets": {
            "S": "buildings-small-01-17-k1.png",
            "M": "buildings-medium-18-34-k1.png",
            "L": "buildings-large-35-50-k1.png",
            "civic": "civic-kit-k1.png",
            "hud": "hud-kit-k1.png",
        },
        "notes": {
            "kept": [
                "ChatGPT 10x3 AXP isometric catalog (already on-vibe)",
                "ChatGPT family trios",
                "CENTER_OF_MAP_HQ office compound",
                "Attached construction / parking / gates / bank, restyled",
                "Jane's Realty HUD gold panels recolored to forest+gold",
                "Jane's houses only after saturation crush",
                "styleui + fruit-tree plants, restyled",
                "bike/road diamonds from SimCity tiles, restyled",
            ],
            "rejected": [
                "FarmVille interiors and furniture",
                "Viking Heroes / Farm Frenzy RPG chrome (swords, animals)",
                "SimCity 2000 building sheets (wrong projection)",
                "photoreal apple icon",
                "robot crew sheet (existing atlas already covers crew)",
                "construction vehicles sheet (scale clash with people)",
                "raw Jane's orange HUD",
            ],
        },
    }
    MANIFEST.joinpath("tileset-manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({k: (len(v) if isinstance(v, dict) else v) for k, v in {
        "buildings": building_boxes,
        "civic": civic_boxes,
        "hud": hud_boxes,
        "small_src": gpt["S"],
        "medium_src": gpt["M"],
        "large_src": gpt["L"],
        "houses": houses,
    }.items()}, default=lambda o: len(o) if hasattr(o, "__len__") else str(o), indent=2))
    print("wrote", OUT / "buildings-small-01-17-k1.png", s_sheet.size)
    print("civic", len(civic_boxes), "hud", len(hud_boxes), "buildings", len(building_boxes))


if __name__ == "__main__":
    import sys

    if "--civic-only" in sys.argv:
        civic_boxes, hud_boxes = write_civic_and_hud()
        existing = {}
        if MANIFEST.joinpath("tileset-manifest.json").exists():
            existing = json.loads(MANIFEST.joinpath("tileset-manifest.json").read_text())
        existing["civic"] = civic_boxes
        existing["hud"] = hud_boxes
        MANIFEST.mkdir(parents=True, exist_ok=True)
        MANIFEST.joinpath("tileset-manifest.json").write_text(json.dumps(existing, indent=2))
        print("civic", len(civic_boxes), "hud", len(hud_boxes))
        for k, v in civic_boxes.items():
            print(k, v)
    else:
        main()
