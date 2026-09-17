#!/usr/bin/env python3
"""Filter, restyle, and atlas fetched/attached tilesets into the AXP city vibe.

Raw packs mix FarmVille pixel interiors, SimCity 2000, cartoon HUD, and
photoreal plants. This script keeps only isometric pieces that can be shifted
onto the existing construction-city palette (olive ground, cream/slate walls,
brass-riveted survey HUD), keys their backgrounds, and writes measured atlases the Phaser
renderer stamps. Repo lots do not receive raw mismatched art.
"""

from __future__ import annotations

import colorsys
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
# Olive-slate plate — same family as lot grass / cream walls, not raw black HUD.
FOREST = (78, 98, 80)
INK = (242, 239, 226)
CREAM = (232, 224, 198)
SLATE = (92, 98, 92)


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


def looks_like_bank(spr: Image.Image) -> bool:
    """The finished $ bank is a civic, never a construction stage."""
    px = spr.load()
    dollar = blue_roof = yellow = n = 0
    for y in range(0, spr.height, 2):
        for x in range(0, spr.width, 2):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            n += 1
            if g > 90 and r < 80 and b < 90:
                dollar += 1
            if b > r + 25 and b > g + 8:
                blue_roof += 1
            if r > 160 and g > 140 and b < 120:
                yellow += 1
    if n < 80:
        return False
    return dollar > 6 or (blue_roof > n * 0.10 and yellow > 8)


def restyle_scaffold(im: Image.Image) -> Image.Image:
    """Ghost-white / cool-grey construction → cream timber and olive-slate, keep edges."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            luma = (r + g + b) / 3.0
            # Cool blue cladding → olive slate (windows stay darker).
            if b > r + 10 and b >= g - 6 and luma < 200:
                t = max(0.0, min(1.0, (luma - 40) / 160))
                px[x, y] = (int(62 + t * 78), int(70 + t * 72), int(58 + t * 58), a)
                continue
            # Posts, ridges, window ink stay slate; pads and roof fills stay cream.
            if luma < 180:
                t = max(0.0, min(1.0, luma / 180))
                px[x, y] = (int(58 + t * 64), int(56 + t * 58), int(46 + t * 48), a)
            else:
                t = max(0.0, min(1.0, (luma - 180) / 75))
                px[x, y] = (int(198 + t * 30), int(186 + t * 26), int(152 + t * 24), a)
    return outline(out, (52, 46, 34, 240))


def extract_construction(sheet: Image.Image, bg: str) -> list[Image.Image]:
    keyed = key_mauve(sheet) if bg == "mauve" else key_teal(sheet) if bg == "teal" else key_near_white(sheet)
    # Left column of construction stages: pad → posts → roof → unfinished shell.
    left = keyed.crop((0, 0, min(220, keyed.width), keyed.height))
    blobs = components(left, min_px=250)
    blobs.sort(key=lambda b: b[1])
    stages = []
    for b in blobs:
        if b[2] < 40 or b[3] < 40:
            continue
        # Dark-roof finish and $ bank sit in the lower third.
        if b[1] > keyed.height * 0.55:
            continue
        spr = trim(b[4])
        if looks_like_bank(spr):
            continue
        stages.append(restyle_scaffold(spr))
        if len(stages) == 4:
            break
    return stages


# Civic-kit boxes for the four stamped stages. The leftover $ bank that once
# landed at (8, 319) as scaffold-4 is cleared, never used as a stage.
SCAFFOLD_BOXES = {
    "scaffold-0": (1142, 8, 87, 73),
    "scaffold-1": (1237, 8, 75, 99),
    "scaffold-2": (1320, 8, 88, 110),
    "scaffold-3": (1416, 8, 95, 110),
}

# Jane Realty lemon church / tan villa / mill / hall. Boxes stay put; $ bank is not here.
JANE_ODD_BOXES = {
    "odd-2": (588, 8, 171, 202),
    "odd-4": (919, 8, 108, 122),
    "odd-6": (1208, 319, 159, 157),
    "city-hall": (436, 8, 144, 125),
}

# Phaser civic frames for inland unused odds. Boxes stay put; $ bank is not here.
CATALOG_ODD_BOXES = {
    "odd-2": (588, 8, 171, 202),
    "odd-3": (767, 8, 144, 139),
    "odd-4": (919, 8, 108, 122),
    "odd-6": (1208, 319, 159, 157),
    "city-hall": (436, 8, 144, 125),
}

# Unused large evolutions from ChatGPT AXP CITY family sheet (08_01_22 AM (1)).
# Kept as a source, but inland odds must NOT stamp these — they clone lot 1–50.
AXP_FAMILY_SHEET = SRC2 / "ChatGPT Image Sep 16, 2026, 08_01_22 AM (1).png"
AXP_ODD_CELLS = {
    "odd-2": 7,       # analytics tower (lot-clone — do not stamp)
    "odd-3": 2,       # data-center slab (lot-clone — do not stamp)
    "odd-4": 9,       # utility plant (lot-clone — do not stamp)
    "odd-6": 5,       # community center (lot-clone — do not stamp)
    "city-hall": 4,   # security hub (lot-clone — do not stamp)
}


def restyle_jane_odd(im: Image.Image) -> Image.Image:
    """Lemon / cartoon-tan Jane walls → catalog cream-khaki; toy-blue glass → slate."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            luma = (r + g + b) / 3.0
            sat = max(r, g, b) - min(r, g, b)
            lemon = r > 155 and g > 130 and b < r - 25 and sat > 40
            tan = r > 140 and g > 100 and b < 130 and r - b > 40 and sat > 45
            toy_blue = b > r + 12 and b >= g - 8 and sat > 30 and luma < 200
            red_roof = r > g + 18 and r > b + 18 and sat > 38 and luma < 215
            if red_roof:
                t = max(0.0, min(1.0, (luma - 40) / 140))
                px[x, y] = (
                    int(108 + t * 36),
                    int(98 + t * 28),
                    int(78 + t * 22),
                    a,
                )
            elif lemon or tan:
                t = max(0.0, min(1.0, (luma - 80) / 160))
                px[x, y] = (
                    int(168 + t * 56),
                    int(156 + t * 52),
                    int(128 + t * 48),
                    a,
                )
            elif toy_blue:
                t = max(0.0, min(1.0, (luma - 40) / 160))
                px[x, y] = (
                    int(72 + t * 50),
                    int(82 + t * 48),
                    int(78 + t * 46),
                    a,
                )
    return out


def stamp_jane_odd_frames(path: Path = OUT / "civic-kit-k1.png") -> None:
    """Crush leftover Jane lemon/tan odds in place. Does not move other civics."""
    kit = open_rgba(path)
    for name, (x, y, w, h) in JANE_ODD_BOXES.items():
        crop = restyle_jane_odd(kit.crop((x, y, x + w, y + h)).copy())
        kit.paste(crop, (x, y))
        print("stamped", name, "jane-odd →", (x, y, w, h))
    kit.save(path)
    print("crushed Jane church/villa/mill/hall onto catalog cream-slate")


def extract_axp_family_band(band: str) -> list[Image.Image]:
    """S/M/L evolutions from the unused AXP family sheet (one size per cell)."""
    if not AXP_FAMILY_SHEET.exists():
        raise SystemExit(f"AXP family sheet missing: {AXP_FAMILY_SHEET}")
    im = key_near_white(open_rgba(AXP_FAMILY_SHEET), thresh=236)
    w, h = im.size
    rows = [(70, 500), (500, h)]
    cols = 5
    frac = {"S": (0.02, 0.28), "M": (0.22, 0.58), "L": (0.55, 0.99)}[band]
    min_w, min_h, min_px = {
        "S": (30, 40, 200),
        "M": (50, 60, 400),
        "L": (80, 90, 500),
    }[band]
    cells: list[Image.Image] = []
    for y0, y1 in rows:
        cw = w / cols
        for c in range(cols):
            x0 = int(c * cw + cw * frac[0])
            x1 = int(c * cw + cw * frac[1]) if frac[1] < 0.99 else int((c + 1) * cw - 4)
            cell = im.crop((x0, y0, x1, y1))
            blobs = [b for b in components(cell, min_px=min_px) if b[2] > min_w and b[3] > min_h]
            blobs.sort(key=lambda b: (b[3], b[2] * b[3]), reverse=True)
            if not blobs:
                raise SystemExit(f"no AXP family {band} building in cell {len(cells)}")
            cells.append(restyle(trim(blobs[0][4]), sat=0.78, contrast=1.04))
    return cells


def extract_axp_family_cells() -> list[Image.Image]:
    """Large buildings from the unused AXP family sheet (right column of each trio)."""
    return extract_axp_family_band("L")


def extract_axp_family_odds() -> dict[str, Image.Image]:
    """Kept as a source. Inland odds must not stamp these — they clone lot 1–50."""
    cells = extract_axp_family_cells()
    return {name: cells[idx] for name, idx in AXP_ODD_CELLS.items()}


# White-solar villa clones among lots 11–16 / 28–34 / 45–50 → unused family-sheet
# industrial silhouettes (not more villas, not sheet-2 catalog lots 1–10 / 18–27 / 35–44).
VILLA_SWAP: dict[int, tuple[str, int]] = {
    11: ("M", 7),  # analytics tower
    13: ("L", 3),  # foundry
    31: ("L", 8),  # creative studio
    32: ("L", 5),  # community center
    33: ("M", 8),  # creative studio
    45: ("L", 7),  # analytics tower
    50: ("M", 5),  # community center
}

# Sheet-1 extras that stacked on sheet-2 S/M/L species into 5+ clone families.
# Mix solarpunk + craft-iso + Jane so the replacements do not become a new mill row.
PLAYER_REPO = ROOT / "assets" / "city-sprites" / "player-repo"
SOLARPUNK_SHEET = SRC2 / "solarpunk_sprite_sheet.jpg"
CRAFT_SHEET = PLAYER_REPO / "isometric_sprite_sheet.jpg"
JANE_REPAIR = SRC2 / "PC _ Computer - Jane's Realty - Buildings - Repair Station.png"
JANE_STORE = SRC2 / "PC _ Computer - Jane's Realty - Buildings - Store.png"
CLONE_BREAK: dict[int, tuple[str, int | str]] = {
    12: ("sp", 8),  # lighthouse — leave crane 7/24/41
    14: ("sp", 0),  # waterwheel — leave lab 3/20/37
    15: ("sp", 11),  # clock tower — leave factory 4/21/38
    16: ("craft", 4),  # kiln dome — leave data 2/19/36
    28: ("jane", "repair"),  # Quonset — leave security 5/22/39
    29: ("craft", 8),  # chimney works
    30: ("craft", 9),  # pottery L-shop
    34: ("sp", 9),  # solar duplex
    46: ("craft", 10),  # wrapped loom tower — leave utility 10/27/44
    47: ("sp", 1),  # clockwork cottage
    48: ("jane", "store"),
    49: ("craft", 14),  # kiln tower, not a second pagoda
}

# Remaining catalog S/M/L DNA: keep the large (or unique) original, replace extras.
# Unused KEEP only — not mushrooms/crystal/honeycomb/cathedral/FarmVille, not a new 5+ family.
JANE_CHURCH = SRC2 / "PC _ Computer - Jane's Realty - Buildings - Church.png"
JANE_HALL = SRC2 / "PC _ Computer - Jane's Realty - Buildings - City Hall.png"
JANE_COTTAGE = SRC2 / "PC _ Computer - Jane's Realty - Buildings - Beach Cottage.png"
JANE_NORWOOD = SRC2 / "PC _ Computer - Jane's Realty - Buildings - Norwood House.png"
JANE_VILLA = SRC2 / "PC _ Computer - Jane's Realty - Buildings - Spanish Villa.png"
JANE_MAP = SRC2 / "PC _ Computer - Jane's Realty - Map - Map Elements.png"
JANE_SHEETS = {
    "repair": JANE_REPAIR,
    "store": JANE_STORE,
    "church": JANE_CHURCH,
    "hall": JANE_HALL,
    "cottage": JANE_COTTAGE,
    "norwood": JANE_NORWOOD,
    "villa": JANE_VILLA,
}
# Finished isometric exteriors only (top-left color building). Interiors, lineart,
# joke props, SC2k tiles, and $ bank stay rejected.
FV_KEEP = {
    "library": SRC1 / "communitybuildings-library.png",
    "school": SRC1 / "communitybuildings-school.png",
    "postoffice": SRC1 / "communitybuildings-postoffice.png",
    "civic": SRC1 / "communitybuildings-civiccenter.png",
    "toyfactory": SRC1 / "businesses-toyfactory.png",
    "apartment": SRC3 / "houses-apartment.png",
    "tudor": SRC1 / "houses-tudorhouse.png",
    "logcabin": SRC1 / "houses-logcabin.png",
    "duplex": SRC3 / "houses-duplex.png",
}
ECO_LARGE = {
    3: PLAYER_REPO / "ChatGPT Image Sep 11, 2026, 10_38_02 AM (3).png",  # helipad
    4: PLAYER_REPO / "ChatGPT Image Sep 11, 2026, 10_38_02 AM (4).png",  # observatory
    7: PLAYER_REPO / "ChatGPT Image Sep 11, 2026, 10_38_02 AM (7).png",  # orchard court
    8: PLAYER_REPO / "ChatGPT Image Sep 11, 2026, 10_38_02 AM (8).png",  # conservatory
}
TRIO_BREAK: dict[int, tuple[str, int | str]] = {
    3: ("craft", 3),  # spa — keep lab 37
    20: ("eco", 4),  # observatory
    5: ("jane", "church"),  # keep security 39
    22: ("eco", 3),  # helipad
    2: ("sp", 4),  # workshop — keep data 36
    19: ("craft", 0),  # loom cottage
    4: ("jane", "hall"),  # keep factory 38
    21: ("eco", 7),  # orchard
    24: ("eco", 8),  # conservatory — keep crane 7, rocket 41
    10: ("craft", 5),  # loom shop — keep utility 44
    27: ("jane", "cottage"),
    9: ("sp", 14),  # slate temple — keep satellite 43
    26: ("craft", 11),  # glass craft tower
    6: ("sp", 5),  # large mill — keep retail 40
    23: ("sp", 10),  # mill tower
    25: ("sp", 6),  # clock factory — keep brick 42
    11: ("jane", "norwood"),  # keep analytics 45
}

# Leftover same-silhouette cousins after trio-break: keep one of each family.
# Unused KEEP only — not mushrooms/crystal/honeycomb/cathedral, not more eco-white
# offices, not AXP catalog DNA, not $ bank, not FarmVille interiors.
COUSIN_BREAK: dict[int, tuple[str, int | str]] = {
    10: ("craft", 1),  # greenhouse — keep mill 6
    14: ("fv", "toyfactory"),  # brick works — keep mill 6
    23: ("fv", "library"),  # civic library
    25: ("fv", "school"),  # keep clock tower 15
    47: ("fv", "duplex"),  # pitched duplex — keep commercial cube 8, not a post cube
    21: ("fv", "civic"),  # capitol — keep eco observatory 20
    22: ("fv", "logcabin"),  # timber cabin — not a walkup cube
    24: ("jane", "windmill"),  # Dutch mill, not a waterwheel
    27: ("jane", "villa"),  # keep ranch 11
    9: ("fv", "tudor"),  # keep pagoda 17; not a second temple
}


def key_attached_paper(im: Image.Image) -> Image.Image:
    """Teal + near-white paper behind the attached construction / civic sheet."""
    return key_color(
        im,
        lambda r, g, b: (
            (g > 90 and b > 90 and r < 95 and (g + b) / 2 - r > 40)
            or (min(r, g, b) >= 236 and abs(r - g) < 18 and abs(g - b) < 18)
        ),
        grow=1,
    )


def restyle_civic_pad(im: Image.Image) -> Image.Image:
    """Warm grey asphalt toward olive-khaki; stall nails stay cream."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            luma = (r + g + b) / 3.0
            sat = max(r, g, b) - min(r, g, b)
            if sat < 28 and 70 < luma < 210:
                t = (luma - 70) / 140
                px[x, y] = (
                    int(92 + t * 70),
                    int(88 + t * 62),
                    int(68 + t * 48),
                    a,
                )
            elif luma >= 210:
                px[x, y] = (232, 224, 198, a)
    return outline(out, (52, 46, 34, 200))


def restyle_civic_rail(im: Image.Image) -> Image.Image:
    return outline(restyle(im, sat=0.62, contrast=1.06), (52, 46, 34, 220))


def restyle_civic_cottage(im: Image.Image) -> Image.Image:
    """Dark hip roof stays slate; cool walls → catalog cream. Not a ChatGPT lot."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            luma = (r + g + b) / 3.0
            sat = max(r, g, b) - min(r, g, b)
            if luma < 100 and sat < 40:
                t = luma / 100
                px[x, y] = (
                    int(42 + t * 36),
                    int(40 + t * 32),
                    int(38 + t * 28),
                    a,
                )
                continue
            if luma > 130:
                t = min(1.0, (luma - 130) / 90)
                px[x, y] = (
                    int(176 + t * 48),
                    int(166 + t * 42),
                    int(138 + t * 36),
                    a,
                )
    return outline(out, (52, 46, 34, 230))


def _fit_cell(spr: Image.Image, w: int, h: int) -> Image.Image:
    spr = scale_to(trim(spr), w, h)
    cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cell.alpha_composite(spr, ((w - spr.width) // 2, h - spr.height))
    return cell


CREAM_YARD = (232, 224, 198, 240)
KHAKI_YARD = (168, 158, 118, 210)
TIMBER = (108, 88, 58, 255)
SLATE_POST = (52, 48, 40, 255)


def recolor_rail(im: Image.Image) -> Image.Image:
    """Hairline grey lattice → timber/slate posts."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            luma = (r + g + b) / 3.0
            if luma < 90:
                px[x, y] = SLATE_POST
            else:
                t = min(1.0, (luma - 90) / 140)
                px[x, y] = (
                    int(102 + t * 20),
                    int(84 + t * 16),
                    int(56 + t * 10),
                    a,
                )
    return out


def thicken_outline(im: Image.Image, radius: int = 3) -> Image.Image:
    """Dilate alpha so 1px rails become posts that survive flyover."""
    a = im.split()[-1]
    fat = a.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    timber = Image.new("RGBA", im.size, (0, 0, 0, 0))
    tp = timber.load()
    fp = fat.load()
    for y in range(im.height):
        for x in range(im.width):
            if fp[x, y] > 16:
                tp[x, y] = TIMBER
    return Image.alpha_composite(timber, recolor_rail(im))


def compose_readable_fence(fence: Image.Image, w: int, h: int) -> Image.Image:
    """Cream/khaki iso yard + thick timber posts. Not a lot house, not lime."""
    cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(cell)
    cx = w / 2
    diamond = [(cx, 8), (w - 5, h * 0.54), (cx, h - 4), (5, h * 0.54)]
    d.polygon(diamond, fill=CREAM_YARD)
    inner = [(cx, 20), (w - 16, h * 0.54), (cx, h - 16), (16, h * 0.54)]
    d.polygon(inner, fill=KHAKI_YARD)
    for i in range(4):
        d.line([diamond[i], diamond[(i + 1) % 4]], fill=SLATE_POST, width=11)
        d.line([diamond[i], diamond[(i + 1) % 4]], fill=TIMBER, width=6)
    for px, py in diamond:
        d.ellipse([px - 7, py - 16, px + 7, py + 5], fill=SLATE_POST)
        d.ellipse([px - 5, py - 20, px + 5, py - 2], fill=TIMBER)
    lattice = thicken_outline(scale_to(trim(fence), w - 12, h - 12), 2)
    cell.alpha_composite(lattice, ((w - lattice.width) // 2, h - lattice.height))
    return cell


def compose_civic_kiosk(gates: list[Image.Image], w: int, h: int) -> Image.Image:
    """Unused civic notice board on a cream pad — not a house, not a parking lot."""
    cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(cell)
    cx = w / 2
    d.polygon(
        [(cx, h * 0.44), (w - 4, h * 0.72), (cx, h - 2), (4, h * 0.72)],
        fill=CREAM_YARD,
    )
    left, right = int(w * 0.28), int(w * 0.62)
    d.rectangle([left, 8, left + 11, int(h * 0.64)], fill=TIMBER)
    d.rectangle([right, 8, right + 11, int(h * 0.64)], fill=TIMBER)
    d.rectangle([left + 2, 10, left + 9, int(h * 0.60)], fill=SLATE_POST)
    d.rectangle([right + 2, 10, right + 9, int(h * 0.60)], fill=SLATE_POST)
    d.rectangle([int(w * 0.20), 10, int(w * 0.80), int(h * 0.46)], fill=(72, 78, 70, 255))
    d.rectangle([int(w * 0.22), 14, int(w * 0.78), int(h * 0.42)], fill=(88, 96, 86, 255))
    d.rectangle([int(w * 0.22), 14, int(w * 0.78), 19], fill=(246, 221, 145, 255))
    for y in (int(h * 0.24), int(h * 0.29), int(h * 0.34)):
        d.line([(int(w * 0.28), y), (int(w * 0.72), y)], fill=(232, 224, 198, 210), width=3)
    if gates:
        face = thicken_outline(scale_to(gates[0], int(w * 0.66), int(h * 0.20)), 1)
        cell.alpha_composite(face, ((w - face.width) // 2, 20))
    return cell


def compose_civic_depot(gates: list[Image.Image], w: int, h: int) -> Image.Image:
    """Timber loading shed on a cream dock — bay door + planked face, not a parking slat."""
    cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(cell)
    cx = w / 2
    d.polygon(
        [(cx, h * 0.36), (w - 3, h * 0.66), (cx, h - 2), (3, h * 0.66)],
        fill=CREAM_YARD,
    )
    d.polygon(
        [(cx, h * 0.50), (w * 0.74, h * 0.68), (cx, h - 8), (w * 0.26, h * 0.68)],
        fill=KHAKI_YARD,
    )
    for i, t in enumerate((0.56, 0.62, 0.68, 0.74)):
        y = h * t
        inset = 4 + i * 3
        d.line([(w * 0.28 + inset, y), (w * 0.72 - inset, y)], fill=TIMBER, width=2)
    d.polygon(
        [(cx, h * 0.78), (w * 0.64, h * 0.88), (cx, h - 3), (w * 0.36, h * 0.88)],
        fill=SLATE_POST,
    )
    roof = [(cx, 2), (w * 0.90, h * 0.22), (cx, h * 0.38), (w * 0.10, h * 0.22)]
    d.polygon(roof, fill=(108, 112, 114, 255))
    d.polygon(
        [(cx, 8), (w * 0.78, h * 0.22), (cx, h * 0.34), (w * 0.22, h * 0.22)],
        fill=(88, 92, 94, 255),
    )
    d.line([roof[0], roof[1], roof[2], roof[3], roof[0]], fill=SLATE_POST, width=3)
    d.polygon(
        [(w * 0.18, h * 0.22), (w * 0.82, h * 0.22), (w * 0.76, h * 0.60), (w * 0.24, h * 0.60)],
        fill=TIMBER,
    )
    d.polygon(
        [(w * 0.32, h * 0.26), (w * 0.68, h * 0.26), (w * 0.64, h * 0.54), (w * 0.36, h * 0.54)],
        fill=(56, 50, 40, 255),
    )
    d.rectangle([int(w * 0.16), int(h * 0.20), int(w * 0.16) + 12, int(h * 0.66)], fill=SLATE_POST)
    d.rectangle([int(w * 0.74), int(h * 0.20), int(w * 0.74) + 12, int(h * 0.66)], fill=SLATE_POST)
    door_l, door_r = int(w * 0.34), int(w * 0.66)
    door_t, door_b = int(h * 0.28), int(h * 0.54)
    d.rectangle([door_l, door_t, door_r, door_b], fill=(56, 50, 40, 255))
    for x in range(door_l + 5, door_r - 3, 7):
        d.line([(x, door_t + 3), (x, door_b - 2)], fill=TIMBER, width=3)
    d.rectangle([door_l, door_t, door_r, door_t + 6], fill=SLATE_POST)
    if gates:
        door = thicken_outline(scale_to(gates[2], int(w * 0.30), int(h * 0.18)), 2)
        cell.alpha_composite(door, ((w - door.width) // 2, int(h * 0.32)))
    return cell


def compose_readable_gates(gates: list[Image.Image], w: int, h: int) -> Image.Image:
    """Cream iso plinth + stacked timber gates. Readable mass at flyover."""
    cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(cell)
    d.polygon(
        [(w / 2, h * 0.34), (w - 3, h * 0.68), (w / 2, h - 3), (3, h * 0.68)],
        fill=CREAM_YARD,
    )
    d.rectangle([5, 3, 16, h - 6], fill=TIMBER)
    d.rectangle([w - 16, 3, w - 5, h - 6], fill=TIMBER)
    d.rectangle([7, 5, 14, h - 8], fill=SLATE_POST)
    d.rectangle([w - 14, 5, w - 7, h - 8], fill=SLATE_POST)
    for y0 in (4, int(h * 0.22), int(h * 0.40)):
        d.rectangle([8, y0 + 5, w - 8, y0 + 18], fill=SLATE_POST)
        d.rectangle([10, y0 + 7, w - 10, y0 + 15], fill=TIMBER)
    g0 = thicken_outline(scale_to(gates[1], w - 6, int(h * 0.44)), 2)
    g1 = thicken_outline(scale_to(gates[4] if len(gates) > 4 else gates[0], w - 6, int(h * 0.44)), 2)
    cell.alpha_composite(g0, ((w - g0.width) // 2, 2))
    cell.alpha_composite(g1, ((w - g1.width) // 2, h - g1.height - 1))
    return cell


def extract_civic_distinct_odds() -> dict[str, Image.Image]:
    """KEEP civic footprints from the attached sheet — not lot-catalog houses."""
    if not ATTACHED.exists():
        raise SystemExit(f"attached civic sheet missing: {ATTACHED}")
    keyed = key_attached_paper(open_rgba(ATTACHED))

    fence = trim(keyed.crop((148, 0, 360, 200)))
    if not fence.getbbox():
        raise SystemExit("fence enclosure missing from attached sheet")
    fence = restyle_civic_rail(fence)

    park = trim(keyed.crop((148, 208, 352, 418)))
    if not park.getbbox() or park.width < 80:
        raise SystemExit("parking pad missing from attached sheet")
    park = restyle_civic_pad(park)

    gates: list[Image.Image] = []
    for i in range(6):
        y0 = i * 70
        gate = trim(keyed.crop((362, y0, 518, y0 + 68)))
        if gate.getbbox() and gate.width > 40 and gate.height > 16:
            gates.append(restyle_civic_rail(gate))
    if len(gates) < 3:
        raise SystemExit(f"not enough attached gates: {len(gates)}")

    boxes = CATALOG_ODD_BOXES
    out: dict[str, Image.Image] = {}

    w, h = boxes["odd-2"][2], boxes["odd-2"][3]
    out["odd-2"] = compose_readable_fence(fence, w, h)

    w, h = boxes["odd-3"][2], boxes["odd-3"][3]
    out["odd-3"] = _fit_cell(park, w, h)

    w, h = boxes["odd-4"][2], boxes["odd-4"][3]
    out["odd-4"] = compose_readable_gates(gates, w, h)

    w, h = boxes["odd-6"][2], boxes["odd-6"][3]
    out["odd-6"] = compose_civic_depot(gates, w, h)

    w, h = boxes["city-hall"][2], boxes["city-hall"][3]
    out["city-hall"] = compose_civic_kiosk(gates, w, h)
    return out


def stamp_civic_distinct_odds(path: Path = OUT / "civic-kit-k1.png") -> None:
    """Stamp KEEP civic-distinct footprints in place. $ bank and scaffolds stay put."""
    odds = extract_civic_distinct_odds()
    kit = open_rgba(path)
    for name, (x, y, w, h) in CATALOG_ODD_BOXES.items():
        cell = odds[name]
        if cell.size != (w, h):
            cell = _fit_cell(cell, w, h)
        kit.paste(cell, (x, y))
        print("stamped", name, "civic-distinct", cell.size, "→", (x, y, w, h))
    kit.save(path)
    print("replaced catalog-clone odds with civic-distinct fence/parking/gates/depot/kiosk")


def stamp_catalog_odds(path: Path = OUT / "civic-kit-k1.png") -> None:
    """Legacy flag: never restore AXP lot-clones into inland odd frames."""
    stamp_civic_distinct_odds(path)


# Measured Phaser frames (src/render/sprites.ts). Roof remap stays in-box.
CATALOG_BUILDING_BOXES: dict[int, tuple[int, int, int, int]] = {
    1: (78, 65, 99, 111),
    2: (329, 56, 110, 120),
    3: (579, 61, 121, 115),
    4: (831, 52, 129, 124),
    5: (1087, 55, 129, 121),
    6: (63, 244, 130, 112),
    7: (322, 237, 123, 119),
    8: (579, 253, 122, 103),
    9: (837, 238, 117, 118),
    10: (1094, 239, 115, 117),
    11: (22, 364, 211, 172),
    12: (283, 364, 202, 172),
    13: (546, 364, 187, 172),
    14: (806, 364, 179, 172),
    15: (1053, 364, 198, 172),
    16: (20, 544, 215, 172),
    17: (298, 545, 171, 171),
    18: (82, 4, 91, 172),
    19: (333, 4, 101, 172),
    20: (584, 4, 111, 172),
    21: (834, 4, 124, 172),
    22: (1094, 4, 115, 172),
    23: (65, 184, 126, 172),
    24: (325, 184, 118, 172),
    25: (573, 184, 134, 172),
    26: (839, 184, 114, 172),
    27: (1097, 184, 109, 172),
    28: (35, 364, 186, 172),
    29: (297, 364, 174, 172),
    30: (550, 364, 179, 172),
    31: (815, 364, 162, 172),
    32: (1062, 364, 180, 172),
    33: (41, 544, 173, 172),
    34: (279, 544, 210, 172),
    35: (129, 5, 61, 171),
    36: (448, 4, 64, 172),
    37: (765, 4, 70, 172),
    38: (1082, 4, 75, 172),
    39: (122, 184, 76, 172),
    40: (440, 184, 80, 172),
    41: (765, 184, 70, 172),
    42: (1079, 184, 82, 172),
    43: (127, 364, 66, 172),
    44: (448, 364, 63, 172),
    45: (718, 364, 163, 172),
    46: (1042, 364, 155, 172),
    47: (82, 544, 156, 172),
    48: (406, 544, 148, 172),
    49: (719, 544, 161, 172),
    50: (1045, 544, 149, 172),
}

CATALOG_SHEETS = {
    "S": (OUT / "buildings-small-01-17-k1.png", range(1, 18)),
    "M": (OUT / "buildings-medium-18-34-k1.png", range(18, 35)),
    "L": (OUT / "buildings-large-35-50-k1.png", range(35, 51)),
}

# Distinct catalog roof families — not one house, not raw terracotta.
ROOF_FAMILIES = (
    (132, 118, 96),   # umber
    (108, 112, 114),  # slate
    (116, 118, 90),   # olive
    (146, 132, 112),  # muted clay
)


def _clamp_byte(v: float) -> int:
    return max(0, min(255, int(round(v))))


def is_high_chroma_orange_roof(r: int, g: int, b: int) -> bool:
    """Terracotta / orange tiles — skip foliage, glass, low-sat wood."""
    if g > r + 12 and g > b + 8:
        return False
    if b > r + 12 and b >= g - 4:
        return False
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    deg = h * 360.0
    orange = 10.0 <= deg <= 42.0
    return orange and s >= 0.38 and v >= 0.34 and r > 120 and r > b + 26


def restyle_catalog_roof(im: Image.Image, building_id: int) -> Image.Image:
    """Pull high-chroma terracotta in the roof band onto a catalog family."""
    out = im.copy()
    px = out.load()
    ys = [y for y in range(out.height) for x in range(out.width) if px[x, y][3] >= 16]
    if not ys:
        return out
    y0, y1 = min(ys), max(ys)
    y_cut = y0 + int((y1 - y0) * 0.66)
    fr, fg, fb = ROOF_FAMILIES[building_id % 4]
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16 or y > y_cut or not is_high_chroma_orange_roof(r, g, b):
                continue
            h, s, _v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            t = 0.86 if s < 0.48 else 0.94
            nr = r * (1 - t) + fr * t
            ng = g * (1 - t) + fg * t
            nb = b * (1 - t) + fb * t
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            new_luma = 0.299 * nr + 0.587 * ng + 0.114 * nb
            if new_luma > 1:
                scale = luma / new_luma
                nr, ng, nb = nr * scale, ng * scale, nb * scale
            px[x, y] = (_clamp_byte(nr), _clamp_byte(ng), _clamp_byte(nb), a)
    return out


def crush_catalog_orange(im: Image.Image, building_id: int) -> Image.Image:
    """Pull leftover high-chroma orange walls onto the catalog roof family."""
    out = im.copy()
    px = out.load()
    fr, fg, fb = ROOF_FAMILIES[building_id % 4]
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16 or not is_high_chroma_orange_roof(r, g, b):
                continue
            h, s, _v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            t = 0.86 if s < 0.48 else 0.94
            nr = r * (1 - t) + fr * t
            ng = g * (1 - t) + fg * t
            nb = b * (1 - t) + fb * t
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            new_luma = 0.299 * nr + 0.587 * ng + 0.114 * nb
            if new_luma > 1:
                scale = luma / new_luma
                nr, ng, nb = nr * scale, ng * scale, nb * scale
            px[x, y] = (_clamp_byte(nr), _clamp_byte(ng), _clamp_byte(nb), a)
    return out


def _ink_blobs(indices: list[int], w: int, h: int) -> list[list[int]]:
    pending = set(indices)
    blobs: list[list[int]] = []
    while pending:
        start = pending.pop()
        q = deque([start])
        pix = [start]
        while q:
            j = q.popleft()
            x, y = j % w, j // w
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                xx, yy = x + dx, y + dy
                k = yy * w + xx
                if 0 <= xx < w and 0 <= yy < h and k in pending:
                    pending.remove(k)
                    q.append(k)
                    pix.append(k)
        blobs.append(pix)
    return blobs


def crush_poster_type(im: Image.Image) -> Image.Image:
    """Flatten lettered poster faces (AIE / OPEN SOURCE / CLEAN COMPUTE), not containers."""
    out = im.copy()
    px = out.load()
    w, h = out.size

    def classify(r: int, g: int, b: int, a: int) -> str | None:
        if a < 16:
            return None
        sat = max(r, g, b) - min(r, g, b)
        luma = (r + g + b) / 3.0
        if g > r + 18 and g > b + 14 and sat > 50 and luma > 70:
            return "foliage"
        if b > r + 16 and b >= g - 2 and sat > 20:
            return "glass"
        if luma >= 168 and sat < 65:
            return "light"
        if 80 <= luma <= 200 and sat < 90 and r >= b - 4:
            return "khaki"
        return "other"

    assigned = [-1] * (w * h)
    comps: list[tuple[str, list[int]]] = []
    cid = 0
    for i in range(w * h):
        if assigned[i] != -1:
            continue
        kind = classify(*px[i % w, i // w])
        if kind not in ("light", "khaki"):
            assigned[i] = -2
            continue
        q = deque([i])
        assigned[i] = cid
        pix = [i]
        while q:
            j = q.popleft()
            x, y = j % w, j // w
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < w and 0 <= yy < h):
                    continue
                k = yy * w + xx
                if assigned[k] != -1:
                    continue
                if classify(*px[xx, yy]) == kind:
                    assigned[k] = cid
                    q.append(k)
                    pix.append(k)
        comps.append((kind, pix))
        cid += 1

    for kind, wall in comps:
        if len(wall) < 200:
            continue
        wallset = set(wall)
        ink: list[int] = []
        for j in wall:
            x, y = j % w, j // w
            for dx in range(-4, 5):
                for dy in range(-4, 5):
                    xx, yy = x + dx, y + dy
                    if not (0 <= xx < w and 0 <= yy < h):
                        continue
                    k = yy * w + xx
                    if k in wallset:
                        continue
                    r, g, b, a = px[xx, yy]
                    if a < 16:
                        continue
                    ck = classify(r, g, b, a)
                    if ck in ("foliage", "glass"):
                        continue
                    wr, wg, wb, _wa = px[x, y]
                    if abs((r + g + b) / 3 - (wr + wg + wb) / 3) > 30:
                        sat = max(r, g, b) - min(r, g, b)
                        if sat > 70:
                            continue
                        ink.append(k)
                        wallset.add(k)
        if len(ink) < 20:
            continue
        letterish = [blob for blob in _ink_blobs(ink, w, h) if 6 <= len(blob) <= 350]
        xs = [j % w for j in wall]
        ys = [j // w for j in wall]
        bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        contrast = [
            k
            for k in ink
            if abs(sum(px[k % w, k // w][:3]) / 3 - sum(px[wall[0] % w, wall[0] // w][:3]) / 3) > 30
        ]
        poster = kind == "light" and len(letterish) >= 8
        small_sign = kind == "khaki" and bw <= 52 and bh >= 28 and len(contrast) >= 12
        if not (poster or small_sign):
            continue
        cols = [px[j % w, j // w] for j in wall]
        cols.sort(key=lambda c: c[0] + c[1] + c[2])
        fill = cols[len(cols) // 2]
        targets = list(wall) + ink if (poster and sum(len(b) for b in letterish) >= 200) or small_sign else ink
        for j in targets:
            r, g, b, a = px[j % w, j // w]
            if classify(r, g, b, a) in ("foliage", "glass"):
                continue
            if (r, g, b) == fill[:3]:
                continue
            px[j % w, j // w] = fill
    return _crush_stacked_sign_letters(out)


def _crush_stacked_sign_letters(im: Image.Image) -> Image.Image:
    """Fill AIE-style stacked reverse letters on a khaki sign, not container stacks."""
    out = im.copy()
    px = out.load()
    w, h = out.size

    def luma(p: tuple[int, ...]) -> float:
        return (p[0] + p[1] + p[2]) / 3.0

    def sat(p: tuple[int, ...]) -> int:
        return max(p[0], p[1], p[2]) - min(p[0], p[1], p[2])

    light: list[tuple[int, int]] = []
    for y in range(h):
        for x in range(int(w * 0.52), w):
            p = px[x, y]
            if p[3] < 16:
                continue
            if luma(p) >= 140 and sat(p) < 75:
                light.append((x, y))
    if len(light) < 20:
        return out
    pending = set(light)
    blobs: list[list[tuple[int, int]]] = []
    while pending:
        start = pending.pop()
        q = deque([start])
        pix = [start]
        while q:
            x, y = q.popleft()
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                t = (x + dx, y + dy)
                if t in pending:
                    pending.remove(t)
                    q.append(t)
                    pix.append(t)
        if 8 <= len(pix) <= 220:
            blobs.append(pix)
    if len(blobs) < 2:
        return out
    centers = [(sum(x for x, _y in b) / len(b), sum(y for _x, y in b) / len(b), b) for b in blobs]
    for i, (cx, _cy, blob) in enumerate(centers):
        stack = [j for j, (cx2, _cy2, _b2) in enumerate(centers) if i != j and abs(cx - cx2) < 16]
        if not stack:
            continue
        khaki: list[tuple[int, ...]] = []
        for x, y in blob:
            for dx in range(-6, 7):
                for dy in range(-6, 7):
                    xx, yy = x + dx, y + dy
                    if not (0 <= xx < w and 0 <= yy < h):
                        continue
                    p = px[xx, yy]
                    if p[3] < 16:
                        continue
                    if 70 <= luma(p) <= 155 and sat(p) < 80:
                        khaki.append(p)
        if len(khaki) < 6:
            continue
        khaki.sort(key=lambda c: c[0] + c[1] + c[2])
        fill = khaki[len(khaki) // 2]
        grown = set(blob)
        q = deque(blob)
        while q:
            x, y = q.popleft()
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < w and 0 <= yy < h) or (xx, yy) in grown:
                    continue
                p = px[xx, yy]
                if p[3] < 16:
                    continue
                if abs(luma(p) - luma(px[x, y])) < 28 and sat(p) < 80:
                    grown.add((xx, yy))
                    q.append((xx, yy))
        if len(grown) > 400:
            continue
        xs = [x for x, _y in grown]
        ys = [y for _x, y in grown]
        x0, x1 = max(0, min(xs) - 3), min(w - 1, max(xs) + 3)
        y0, y1 = max(0, min(ys) - 3), min(h - 1, max(ys) + 3)
        if x1 - x0 > 56 or y1 - y0 > 90:
            continue
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                p = px[x, y]
                if p[3] < 16:
                    continue
                if luma(p) >= 130 and sat(p) < 80:
                    px[x, y] = fill
                elif (x, y) in grown:
                    px[x, y] = fill
    # Right-edge khaki sign board: paint the whole plaque, letters included.
    opaque = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] >= 16]
    if opaque:
        xs = [x for x, _y in opaque]
        ys = [y for _x, y in opaque]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        sx0 = x0 + int(bw * 0.72)
        sy0, sy1 = y0 + int(bh * 0.16), y0 + int(bh * 0.78)
        if sx0 < x1 and sy1 - sy0 > 20:
            khaki_cols: list[tuple[int, ...]] = []
            n = 0
            for y in range(sy0, sy1 + 1):
                for x in range(sx0, x1 + 1):
                    p = px[x, y]
                    if p[3] < 16:
                        continue
                    n += 1
                    if 65 <= luma(p) <= 165 and sat(p) < 85:
                        khaki_cols.append(p)
            if n >= 40 and len(khaki_cols) >= n * 0.30:
                khaki_cols.sort(key=lambda c: c[0] + c[1] + c[2])
                fill = khaki_cols[len(khaki_cols) // 2]
                for y in range(sy0, sy1 + 1):
                    for x in range(sx0, x1 + 1):
                        p = px[x, y]
                        if p[3] < 16:
                            continue
                        if p[2] > p[0] + 16 and p[2] >= p[1] - 2:
                            continue
                        px[x, y] = fill
    return out


def stamp_catalog_roofs() -> None:
    """Remap terracotta roofs in place. Sprite boxes and silhouettes stay put."""
    for name, (path, ids) in CATALOG_SHEETS.items():
        kit = open_rgba(path)
        n = 0
        for bid in ids:
            x, y, w, h = CATALOG_BUILDING_BOXES[bid]
            crop = restyle_catalog_roof(kit.crop((x, y, x + w, y + h)).copy(), bid)
            kit.paste(crop, (x, y))
            n += 1
        kit.save(path)
        print("stamped catalog roofs", name, n, "→", path)


def stamp_diversify_villas() -> None:
    """Replace the most cloned suburban villas with unused family footprints."""
    family: dict[str, list[Image.Image]] = {}
    sheets: dict[str, Image.Image] = {}
    for bid, (fam_band, idx) in VILLA_SWAP.items():
        if fam_band not in family:
            family[fam_band] = extract_axp_family_band(fam_band)
        sheet_band = "S" if bid <= 17 else "M" if bid <= 34 else "L"
        path, _ids = CATALOG_SHEETS[sheet_band]
        if sheet_band not in sheets:
            sheets[sheet_band] = open_rgba(path)
        x, y, w, h = CATALOG_BUILDING_BOXES[bid]
        spr = crush_poster_type(
            crush_catalog_orange(
                restyle_catalog_roof(
                    restyle(scale_to(trim(family[fam_band][idx]), w, h), sat=0.62, contrast=1.02),
                    bid,
                ),
                bid,
            )
        )
        cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        cell.alpha_composite(spr, ((w - spr.width) // 2, h - spr.height))
        sheets[sheet_band].paste(cell, (x, y))
        print("stamped villa-swap", bid, fam_band, idx, "→", (x, y, w, h))
    for sheet_band, kit in sheets.items():
        path, _ids = CATALOG_SHEETS[sheet_band]
        kit.save(path)
        print("saved diversify", sheet_band, path)


def _resolve_sheet(*candidates: Path) -> Path:
    for path in candidates:
        if path.exists():
            return path
    raise SystemExit(f"keep sheet missing, tried: {candidates}")


def extract_grid_keep(path: Path, idx: int, cols: int = 5, rows: int = 3) -> Image.Image:
    """KEEP isometric grid footprint; crush grass, leave the building silhouette."""
    im = key_near_white(open_rgba(path), thresh=236)
    cw, ch = im.width / cols, im.height / rows
    r, c = divmod(idx, cols)
    cell = im.crop((int(c * cw) + 8, int(r * ch) + 8, int((c + 1) * cw) - 8, int((r + 1) * ch) - 8))
    blobs = [b for b in components(cell, min_px=400) if b[2] > 60 and b[3] > 50]
    blobs.sort(key=lambda b: b[2] * b[3], reverse=True)
    if not blobs:
        raise SystemExit(f"no keep building in {path.name} cell {idx}")
    src = trim(blobs[0][4])
    spr = restyle(src, sat=0.50, contrast=1.02)
    spx = spr.load()
    rpx = src.load()
    ground = int(spr.height * 0.72)
    for y in range(spr.height):
        for x in range(spr.width):
            r0, g0, b0, a0 = rpx[x, y]
            if a0 < 16:
                continue
            # Drop the grass pad; khaki rooftop ivy so glass towers stay solid.
            if g0 > r0 + 16 and g0 > b0 + 10 and max(r0, g0, b0) - min(r0, g0, b0) > 20:
                if y > ground:
                    spx[x, y] = (0, 0, 0, 0)
                else:
                    t = max(0.0, min(1.0, ((r0 + g0 + b0) / 3 - 60) / 140))
                    spx[x, y] = (
                        int(110 + t * 70),
                        int(108 + t * 62),
                        int(82 + t * 48),
                        a0,
                    )
    return lift_keep_vibe(trim(spr))


def lift_keep_vibe(im: Image.Image) -> Image.Image:
    """Brown craft wood → khaki/cream walls so KEEP stamps share the catalog vibe."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            luma = (r + g + b) / 3.0
            sat = max(r, g, b) - min(r, g, b)
            brown = r > g + 2 and r > b + 8 and sat > 16
            if not brown:
                continue
            t = 0.52
            nr = r * (1 - t) + 168 * t
            ng = g * (1 - t) + 158 * t
            nb = b * (1 - t) + 118 * t
            new_luma = (nr + ng + nb) / 3.0
            if new_luma > 1:
                scale = luma / new_luma
                nr, ng, nb = nr * scale, ng * scale, nb * scale
            px[x, y] = (_clamp_byte(nr), _clamp_byte(ng), _clamp_byte(nb), a)
    return out


def extract_jane_lot(kind: str) -> Image.Image:
    """Finished Jane building — not a construction frame, fence, or parking pad."""
    path = JANE_SHEETS.get(kind)
    if path is None or not path.exists():
        raise SystemExit(f"Jane {kind} sheet missing: {path}")
    # Backdrop is ~ (0,128,128). Broader teal key eats finished blue roofs.
    keyed = key_color(
        open_rgba(path),
        lambda r, g, b: r < 40 and g > 90 and b > 90 and abs(g - b) < 30,
        grow=1,
    )
    blobs = [b for b in components(keyed, min_px=500) if b[2] > 55 and b[3] > 50]
    scored: list[tuple[float, Image.Image]] = []
    for _x, y0, bw, bh, crop in blobs:
        spr = trim(crop)
        if is_gray_pad(spr) or is_fragment(spr) or bh < 55 or bw > bh * 3.2:
            continue
        px = spr.load()
        n = chroma = green = 0
        lumas: list[float] = []
        for y in range(0, spr.height, 2):
            for x in range(0, spr.width, 2):
                r, g, b, a = px[x, y]
                if a < 16:
                    continue
                n += 1
                lumas.append((r + g + b) / 3.0)
                if max(r, g, b) - min(r, g, b) > 28:
                    chroma += 1
                if g > r + 12 and g > b + 8:
                    green += 1
        if n < 80:
            continue
        fill = n / max((spr.width * spr.height) / 4, 1)
        rng = max(lumas) - min(lumas) if lumas else 0
        chroma_f = chroma / n
        if fill < 0.22 or green / n > 0.40:
            continue
        if chroma_f < 0.12 or (rng < 140 and fill > 0.5):
            continue
        score = (y0 / max(keyed.height, 1)) * 2.2 + rng / 255 + fill + chroma_f * 0.25
        scored.append((score, spr))
    if not scored:
        raise SystemExit(f"Jane {kind} finished building missing")
    scored.sort(key=lambda t: -t[0])
    return restyle_jane_odd(restyle(scored[0][1], sat=0.66, contrast=1.06))


def extract_eco_large(sheet_id: int) -> Image.Image:
    """Largest building from an unused player-repo eco trio (not a 3-size clone)."""
    path = ECO_LARGE.get(sheet_id)
    if path is None or not path.exists():
        raise SystemExit(f"eco sheet {sheet_id} missing: {path}")
    im = key_near_white(open_rgba(path), thresh=236)
    blobs = [b for b in components(im, min_px=800) if b[2] > 80 and b[3] > 70]
    blobs.sort(key=lambda b: b[2] * b[3], reverse=True)
    if not blobs:
        raise SystemExit(f"no eco building on {path.name}")
    src = trim(blobs[0][4])
    spr = restyle(src, sat=0.50, contrast=1.02)
    spx = spr.load()
    rpx = src.load()
    ground = int(spr.height * 0.70)
    for y in range(spr.height):
        for x in range(spr.width):
            r0, g0, b0, a0 = rpx[x, y]
            if a0 < 16:
                continue
            if g0 > r0 + 16 and g0 > b0 + 10 and max(r0, g0, b0) - min(r0, g0, b0) > 20:
                if y > ground:
                    spx[x, y] = (0, 0, 0, 0)
                else:
                    t = max(0.0, min(1.0, ((r0 + g0 + b0) / 3 - 60) / 140))
                    spx[x, y] = (
                        int(110 + t * 70),
                        int(108 + t * 62),
                        int(82 + t * 48),
                        a0,
                    )
    return lift_keep_vibe(trim(spr))


def extract_solarpunk_cell(idx: int) -> Image.Image:
    """KEEP isometric solarpunk footprint (no mushroom/crystal cells)."""
    path = _resolve_sheet(SOLARPUNK_SHEET, PLAYER_REPO / "solarpunk_sprite_sheet.jpg")
    return extract_grid_keep(path, idx)


def extract_craft_cell(idx: int) -> Image.Image:
    """KEEP isometric craft footprint (no honeycomb / cathedral / greenhouse clones)."""
    path = _resolve_sheet(CRAFT_SHEET, SRC2 / "isometric_sprite_sheet.jpg")
    return extract_grid_keep(path, idx)


def crush_roof_badge(im: Image.Image) -> Image.Image:
    """Flatten leftover oval roof signs (Store plate / wrench) onto slate."""
    out = im.copy()
    px = out.load()
    w, h = out.size
    slate: list[tuple[int, int, int, int, int, int]] = []
    badge: list[tuple[int, int]] = []
    roof_h = int(h * 0.58)
    for y in range(roof_h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            luma = (r + g + b) / 3.0
            sat = max(r, g, b) - min(r, g, b)
            if luma < 130 and sat < 40:
                slate.append((x, y, r, g, b, a))
            elif luma > 155 and sat < 70:
                badge.append((x, y))
    if len(slate) > 80 and 20 < len(badge) < len(slate) * 0.55:
        fill = slate[len(slate) // 2][2:]
        for x, y in badge:
            px[x, y] = fill
    # Compact light islands on the roof (ghost ovals that survived the first pass).
    seen = bytearray(w * roof_h)

    def sample(x: int, y: int) -> tuple[float, float, tuple[int, int, int, int]] | None:
        r, g, b, a = px[x, y]
        if a < 16:
            return None
        return ((r + g + b) / 3.0, max(r, g, b) - min(r, g, b), (r, g, b, a))

    for y in range(roof_h):
        for x in range(w):
            if seen[y * w + x]:
                continue
            cur = sample(x, y)
            if not cur or cur[0] < 165 or cur[1] > 75:
                seen[y * w + x] = 1
                continue
            stack = [(x, y)]
            pix: list[tuple[int, int]] = []
            seen[y * w + x] = 1
            while stack:
                cx, cy = stack.pop()
                pix.append((cx, cy))
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    xx, yy = cx + dx, cy + dy
                    if 0 <= xx < w and 0 <= yy < roof_h and not seen[yy * w + xx]:
                        seen[yy * w + xx] = 1
                        nxt = sample(xx, yy)
                        if nxt and nxt[0] >= 150 and nxt[1] < 80:
                            stack.append((xx, yy))
            if not (24 <= len(pix) <= 1100):
                continue
            xs = [p[0] for p in pix]
            ys = [p[1] for p in pix]
            bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
            if bw * bh > len(pix) * 3.4:
                continue
            fill = (92, 98, 92, 255)
            for sx in range(max(0, min(xs) - 6), min(w, max(xs) + 7)):
                for sy in range(max(0, min(ys) - 6), min(roof_h, max(ys) + 7)):
                    near = sample(sx, sy)
                    if near and near[0] < 130 and near[1] < 40:
                        fill = near[2]
                        break
                else:
                    continue
                break
            for cx, cy in pix:
                px[cx, cy] = fill
    return out


# Dutch mill sails/walls are warm tan; catalog orange crush flattens them into one umber blob.
COUSIN_SKIP_ROOF_CRUSH = {24}


def prepare_lot_stamp(spr: Image.Image, bid: int, w: int, h: int) -> Image.Image:
    fitted = scale_to(trim(spr), w, h)
    if bid in COUSIN_SKIP_ROOF_CRUSH:
        return crush_roof_badge(crush_poster_type(fitted))
    return crush_roof_badge(
        crush_poster_type(crush_catalog_orange(restyle_catalog_roof(fitted, bid), bid))
    )


def _is_lineart(spr: Image.Image) -> bool:
    px = spr.load()
    n = chroma = 0
    for y in range(0, spr.height, 3):
        for x in range(0, spr.width, 3):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            n += 1
            if max(r, g, b) - min(r, g, b) > 22:
                chroma += 1
    return n > 40 and chroma / n < 0.08


def _keep_sat(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def _keep_luma(r: int, g: int, b: int) -> float:
    return (r + g + b) / 3.0


def _is_snow_roof(r: int, g: int, b: int) -> bool:
    return min(r, g, b) > 198 and _keep_sat(r, g, b) < 36


def _is_keep_foliage(r: int, g: int, b: int, a: int) -> bool:
    if a < 16 or _is_snow_roof(r, g, b):
        return False
    return g > r + 6 and g > b + 3 and _keep_sat(r, g, b) > 14


def _is_keep_timber(r: int, g: int, b: int, a: int) -> bool:
    return a >= 16 and r > g + 12 and r > b + 8 and 45 < _keep_luma(r, g, b) < 190


def _is_dark_canopy(r: int, g: int, b: int, a: int) -> bool:
    """Pine crown after keying — near-black / olive, not log-end rings."""
    if a < 16 or _is_snow_roof(r, g, b) or _is_keep_timber(r, g, b, a):
        return False
    luma = _keep_luma(r, g, b)
    if luma < 78 and _keep_sat(r, g, b) < 55:
        return True
    return g >= r - 2 and g > b and luma < 110 and _keep_sat(r, g, b) > 8


def drop_yard_hedge(spr: Image.Image) -> Image.Image:
    """Drop green lawn/hedge before restyle so it does not bake into a cream ghost."""
    out = spr.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            if g > r + 10 and g > b + 6 and _keep_sat(r, g, b) > 18 and not _is_snow_roof(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    return trim(out)


def drop_cabin_roof_tree(spr: Image.Image) -> Image.Image:
    """Remove the hanging pine on the right gable. Keep the green door and logs."""
    out = spr.copy()
    px = out.load()
    w, h = out.size
    x0 = int(w * 0.66)
    y1 = int(h * 0.64)
    for y in range(0, y1):
        for x in range(x0, w):
            r, g, b, a = px[x, y]
            if _is_keep_foliage(r, g, b, a) or _is_dark_canopy(r, g, b, a):
                px[x, y] = (0, 0, 0, 0)
    # Close 1px bites in the snow gable without growing a new roof lobe.
    for _ in range(8):
        fills: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(0, y1):
            for x in range(x0, w):
                if px[x, y][3] >= 16:
                    continue
                neigh: list[tuple[int, int, int, int]] = []
                roof_n = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        xx, yy = x + dx, y + dy
                        if 0 <= xx < w and 0 <= yy < h:
                            rr, gg, bb, aa = px[xx, yy]
                            if aa >= 16:
                                neigh.append((rr, gg, bb, aa))
                                if aa >= 16 and _keep_luma(rr, gg, bb) > 165 and _keep_sat(rr, gg, bb) < 55:
                                    roof_n += 1
                if roof_n >= 5 and neigh:
                    mid = len(neigh) // 2
                    rs = sorted(c[0] for c in neigh)
                    gs = sorted(c[1] for c in neigh)
                    bs = sorted(c[2] for c in neigh)
                    fills.append((x, y, (rs[mid], gs[mid], bs[mid], 255)))
        for x, y, col in fills:
            px[x, y] = col
        if not fills:
            break
    # Isolated dark specks left on the right ridge after the pine crown keys out.
    for y in range(0, int(h * 0.50)):
        for x in range(int(w * 0.70), w):
            r, g, b, a = px[x, y]
            if a < 16 or _is_keep_timber(r, g, b, a) or _is_snow_roof(r, g, b):
                continue
            if _keep_luma(r, g, b) >= 95:
                continue
            opaque_n = 0
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    if dx == 0 and dy == 0:
                        continue
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h and px[xx, yy][3] >= 16:
                        opaque_n += 1
            if opaque_n <= 8:
                px[x, y] = (0, 0, 0, 0)
    return trim(out)


def extract_fv_keep(name: str) -> Image.Image:
    """Finished isometric exterior from src1/src3 — never interiors or lineart."""
    path = FV_KEEP.get(name)
    if path is None or not path.exists():
        raise SystemExit(f"fv keep {name} missing: {path}")
    im = open_rgba(path)
    w, h = im.size
    cell = im.crop((0, 0, int(w * 0.42), int(h * 0.48)))
    keyed = key_near_white(cell, thresh=232)
    opaque = 0
    kpx = keyed.load()
    for y in range(0, keyed.height, 3):
        for x in range(0, keyed.width, 3):
            if kpx[x, y][3] >= 16:
                opaque += 1
    if opaque < 80:
        keyed = key_black(cell, thresh=22)
    blobs = [b for b in components(keyed, min_px=800) if b[2] > 70 and b[3] > 70]
    blobs.sort(key=lambda b: b[2] * b[3], reverse=True)
    for blob in blobs:
        spr = trim(blob[4])
        if _is_lineart(spr) or is_gray_pad(spr):
            continue
        # Drop yard / roof-tree while foliage is still green — restyle turns pines umber.
        if name == "logcabin":
            spr = drop_cabin_roof_tree(spr)
        elif name in ("tudor", "duplex"):
            spr = drop_yard_hedge(spr)
        spr = restyle_jane_odd(restyle(spr, sat=0.48, contrast=1.04))
        if name == "tudor":
            # Pale garden ghosts left after green drop — pad only, not tan walls.
            px = spr.load()
            y0 = int(spr.height * 0.82)
            for y in range(y0, spr.height):
                for x in range(spr.width):
                    r, g, b, a = px[x, y]
                    if a < 16:
                        continue
                    if min(r, g, b) > 198 and _keep_sat(r, g, b) < 36:
                        px[x, y] = (0, 0, 0, 0)
            spr = trim(spr)
        return spr
    raise SystemExit(f"no finished exterior in {path.name}")


def extract_jane_windmill() -> Image.Image:
    """One Dutch mill from the map sheet — not the stacked column, not a waterwheel.

    sat=0.48 matches FV KEEP / grid KEEP so the mill does not read as a second game.
    """
    path = JANE_MAP
    if not path.exists():
        raise SystemExit(f"Jane windmill sheet missing: {path}")
    # Blades of neighboring mills touch; crop one measured cell instead of the column.
    keyed = key_teal(open_rgba(path).crop((0, 8, 128, 128)))
    blobs = [b for b in components(keyed, min_px=280) if b[2] > 40 and b[3] > 48]
    blobs.sort(key=lambda b: b[2] * b[3], reverse=True)
    if not blobs:
        raise SystemExit("Jane windmill missing")
    spr = trim(blobs[0][4])
    px = spr.load()
    for y in range(spr.height):
        for x in range(spr.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            # Yard grass + fence hedge — keep tan timber and cream sails.
            if g > r + 8 and g > b + 4 and max(r, g, b) - min(r, g, b) > 16:
                px[x, y] = (0, 0, 0, 0)
    spr = restyle(trim(spr), sat=0.48, contrast=1.06)
    # Terracotta roof only. restyle_jane_odd would also flatten tan walls into the sails.
    px = spr.load()
    for y in range(spr.height):
        for x in range(spr.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 8 <= h * 360 <= 40 and s >= 0.28 and v >= 0.35 and r > b + 20 and r > g + 8:
                t = max(0.0, min(1.0, ((r + g + b) / 3 - 40) / 140))
                px[x, y] = (
                    int(108 + t * 36),
                    int(98 + t * 28),
                    int(78 + t * 22),
                    a,
                )
    return spr


def extract_keep_stamp(src: str, key: int | str) -> Image.Image:
    if src == "sp":
        return extract_solarpunk_cell(int(key))
    if src == "craft":
        return extract_craft_cell(int(key))
    if src == "jane":
        if key == "windmill":
            return extract_jane_windmill()
        return extract_jane_lot(str(key))
    if src == "eco":
        return extract_eco_large(int(key))
    if src == "fv":
        return extract_fv_keep(str(key))
    raise SystemExit(f"unknown keep source {src}")


def stamp_keep_map(mapping: dict[int, tuple[str, int | str]], label: str) -> None:
    sheets: dict[str, Image.Image] = {}
    for bid, (src, key) in mapping.items():
        spr = extract_keep_stamp(src, key)
        sheet_band = "S" if bid <= 17 else "M" if bid <= 34 else "L"
        path, _ids = CATALOG_SHEETS[sheet_band]
        if sheet_band not in sheets:
            sheets[sheet_band] = open_rgba(path)
        x, y, w, h = CATALOG_BUILDING_BOXES[bid]
        cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        fitted = prepare_lot_stamp(spr, bid, w, h)
        cell.alpha_composite(fitted, ((w - fitted.width) // 2, h - fitted.height))
        sheets[sheet_band].paste(cell, (x, y))
        print("stamped", label, bid, src, key, "→", (x, y, w, h))
    for sheet_band, kit in sheets.items():
        path, _ids = CATALOG_SHEETS[sheet_band]
        kit.save(path)
        print("saved", label, sheet_band, path)


def stamp_break_clone_clusters() -> None:
    """Replace 5+ species stacks with unused KEEP silhouettes, not tints."""
    stamp_keep_map(CLONE_BREAK, "clone-break")


def stamp_break_catalog_trios() -> None:
    """Keep one catalog size per species; replace the extras. Restamp lot 48 oval."""
    stamp_keep_map(TRIO_BREAK, "trio-break")
    stamp_keep_map({48: CLONE_BREAK[48]}, "store-badge")


def stamp_break_cousin_clusters() -> None:
    """Replace leftover mill/clock/eco/ranch cousins with unused KEEP silhouettes."""
    stamp_keep_map(COUSIN_BREAK, "cousin-break")


def crush_stamped_lot_chroma(bid: int, target: float = 26.0) -> float:
    """Pull one stamped lot's chroma toward the khaki catalog without moving silhouette."""
    band = "S" if bid <= 17 else "M" if bid <= 34 else "L"
    path, _ids = CATALOG_SHEETS[band]
    kit = open_rgba(path)
    x, y, w, h = CATALOG_BUILDING_BOXES[bid]
    cell = kit.crop((x, y, x + w, y + h))
    px = cell.load()
    chromas: list[int] = []
    for yy in range(h):
        for xx in range(w):
            r, g, b, a = px[xx, yy]
            if a < 16:
                continue
            chromas.append(max(r, g, b) - min(r, g, b))
    mean = sum(chromas) / max(len(chromas), 1)
    if mean <= target:
        print("lot", bid, "chroma", round(mean, 1), "already <=", target)
        return mean
    scale = target / mean
    for yy in range(h):
        for xx in range(w):
            r, g, b, a = px[xx, yy]
            if a < 16:
                continue
            hh, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            nr, ng, nb = colorsys.hsv_to_rgb(hh, min(1.0, s * scale), v)
            px[xx, yy] = (int(nr * 255 + 0.5), int(ng * 255 + 0.5), int(nb * 255 + 0.5), a)
    kit.paste(cell, (x, y))
    kit.save(path)
    print("crushed lot", bid, "chroma", round(mean, 1), "→", target, "scale", round(scale, 3), path)
    return target


def stamp_jane_windmill() -> None:
    """Restamp the Dutch mill, then crush leftover sail/roof chroma onto khaki KEEP."""
    stamp_keep_map({24: ("jane", "windmill")}, "jane-windmill")
    crush_stamped_lot_chroma(24, 26.0)


def restyle_pagoda(im: Image.Image) -> Image.Image:
    """Teal Jane pagoda roof → slate; vermilion posts → timber. Silhouette stays."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            luma = (r + g + b) / 3.0
            sat = max(r, g, b) - min(r, g, b)
            teal = (g > r + 6 and b > r + 2 and sat > 18) or (
                g > r + 4 and b >= g - 10 and sat > 22 and luma < 210
            )
            vermilion = r > g + 28 and r > b + 18 and sat > 36
            if teal:
                t = max(0.0, min(1.0, (luma - 40) / 140))
                px[x, y] = (
                    int(88 + t * 36),
                    int(92 + t * 34),
                    int(90 + t * 32),
                    a,
                )
            elif vermilion:
                t = max(0.0, min(1.0, (luma - 40) / 140))
                px[x, y] = (
                    int(108 + t * 28),
                    int(88 + t * 22),
                    int(58 + t * 18),
                    a,
                )
    return out


def stamp_pagoda_vibe() -> None:
    path, _ids = CATALOG_SHEETS["S"]
    kit = open_rgba(path)
    x, y, w, h = CATALOG_BUILDING_BOXES[17]
    crop = restyle_pagoda(kit.crop((x, y, x + w, y + h)).copy())
    kit.paste(crop, (x, y))
    kit.save(path)
    print("stamped pagoda vibe", (x, y, w, h))


def stamp_scaffold_frames(path: Path = OUT / "civic-kit-k1.png") -> None:
    """Re-extract scaffold-0..3 into existing boxes. Does not move other civics."""
    if not ATTACHED.exists():
        raise SystemExit(f"attached construction sheet missing: {ATTACHED}")
    stages = extract_construction(open_rgba(ATTACHED), "mauve")
    if len(stages) != 4:
        raise SystemExit(f"expected 4 construction stages, got {len(stages)}")
    kit = open_rgba(path)
    leftover = (8, 319, 70, 116)
    kit.paste(Image.new("RGBA", leftover[2:4], (0, 0, 0, 0)), leftover[:2])
    for spr, (name, (x, y, w, h)) in zip(stages, SCAFFOLD_BOXES.items()):
        spr = scale_to(trim(spr), w, h)
        cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        cell.alpha_composite(spr, ((w - spr.width) // 2, h - spr.height))
        kit.paste(cell, (x, y))
        print(name, spr.size, "→", (x, y, w, h))
    kit.save(path)
    print("stamped scaffold-0..3; cleared leftover $ bank at", leftover)


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
                tiles.append(outline(restyle(trim(b[4]), sat=0.62, contrast=1.18)))
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
                px[x, y] = (72, 92, 74, a)
            elif r > 90 and g > 55 and b < 70:
                px[x, y] = FOREST + (a,)
    return restyle(keyed, sat=0.8, contrast=1.04)


# Olive-umber timber — same family as lot grass / cream walls, not raw walnut.
WOOD = (96, 88, 62)
WOOD_DK = (58, 54, 40)
WOOD_LT = (148, 138, 98)
SLATE_DK = (40, 48, 42)
SLATE_LT = (98, 110, 96)
BRASS = (196, 162, 78)
BRASS_DK = (132, 102, 46)
PULP = (228, 218, 186)
RIVET = (216, 186, 102)


def _rivet(draw: ImageDraw.ImageDraw, x: int, y: int, r: int = 3) -> None:
    draw.ellipse((x - r, y - r, x + r, y + r), fill=RIVET + (255,), outline=BRASS_DK + (255,))
    draw.point((x - 1, y - 1), fill=(238, 216, 148, 255))


def _chamfer(x: int, y: int, w: int, h: int, c: int = 7) -> list[tuple[int, int]]:
    return [
        (x + c, y),
        (x + w - c, y),
        (x + w, y + c),
        (x + w, y + h - c),
        (x + w - c, y + h),
        (x + c, y + h),
        (x, y + h - c),
        (x, y + c),
    ]


# Civic KEEP crops already filtered from the attached construction/gates/bank
# sheet + zip kits. Jane chrome is not sampled.
# Tight pad/roof faces only — parking grain, not a tiled house or door strip.
_HUD_KEEP_CROPS = {
    "cream": (1342, 30, 40, 28),   # scaffold-2 roof plane
    "khaki": (116, 349, 70, 50),   # parking asphalt → khaki
    "slate": (116, 349, 70, 50),   # parking asphalt → slate
    "timber": (116, 349, 70, 50),  # parking asphalt → umber timber
}


def _interior_crop(im: Image.Image, margin: float = 0.20) -> Image.Image:
    w, h = im.size
    mx, my = max(2, int(w * margin)), max(2, int(h * margin))
    if w - 2 * mx < 8 or h - 2 * my < 8:
        return im
    return im.crop((mx, my, w - mx, h - my))


def _shift_swatch(im: Image.Image, target: tuple[int, int, int], strength: float = 0.62) -> Image.Image:
    """Keep KEEP grain, lean the mean onto catalog cream/khaki/slate."""
    out = im.convert("RGBA")
    px = out.load()
    n = sr = sg = sb = 0
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            n += 1
            sr += r
            sg += g
            sb += b
    if n < 8:
        return out
    mr, mg, mb = sr / n, sg / n, sb / n
    tr, tg, tb = target
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            px[x, y] = (
                max(0, min(255, int(r + (tr - mr) * strength))),
                max(0, min(255, int(g + (tg - mg) * strength))),
                max(0, min(255, int(b + (tb - mb) * strength))),
                a,
            )
    return out


def keep_hud_swatches() -> dict[str, Image.Image]:
    """Cream / khaki / slate / timber faces from restyled civic KEEP, not Jane HUD."""
    civic_path = OUT / "civic-kit-k1.png"
    swatches: dict[str, Image.Image] = {}
    if civic_path.exists():
        civic = open_rgba(civic_path)
        targets = {
            "cream": CREAM,
            "khaki": WOOD_LT,
            "slate": FOREST,
            "timber": WOOD,
        }
        for name, (x, y, w, h) in _HUD_KEEP_CROPS.items():
            crop = _interior_crop(civic.crop((x, y, x + w, y + h)))
            if crop.getbbox():
                swatches[name] = _shift_swatch(crop, targets[name])
    # Catalog cream wall (lot 8 shop) if civic cladding is missing.
    shop = OUT / "buildings-small-01-17-k1.png"
    if shop.exists() and "cream" not in swatches:
        wall = _interior_crop(open_rgba(shop).crop((579, 253, 701, 356)), 0.28)
        if wall.getbbox():
            swatches["cream"] = _shift_swatch(wall, CREAM)
    return swatches


def _tile_swatch(swatch: Image.Image | None, w: int, h: int, fallback: tuple[int, int, int]) -> Image.Image:
    out = Image.new("RGBA", (w, h), fallback + (242,))
    if swatch is None or swatch.width < 6 or swatch.height < 6:
        return out
    src = swatch.convert("RGBA")
    for y in range(0, h, src.height):
        for x in range(0, w, src.width):
            out.paste(src, (x, y), src)
    return out


def _mask_polygon(w: int, h: int, pts: list[tuple[int, int]], origin: tuple[int, int]) -> Image.Image:
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon([(px - origin[0], py - origin[1]) for px, py in pts], fill=255)
    return mask


def _paint_keep_face(
    kit: Image.Image,
    pts: list[tuple[int, int]],
    x: int,
    y: int,
    w: int,
    h: int,
    swatch: Image.Image | None,
    fallback: tuple[int, int, int],
) -> None:
    fill = _tile_swatch(swatch, w, h, fallback)
    fill.putalpha(_mask_polygon(w, h, pts, (x, y)))
    kit.alpha_composite(fill, (x, y))


def hud_kit(_hud: Image.Image | None = None) -> tuple[Image.Image, dict]:
    """Survey plaques tiled from restyled civic KEEP (scaffold/gate/parking/bank).

    Jane chrome is not copied. Frame sizes stay the same so HudScene hit
    targets keep working. BitmapText ink() is unchanged.
    """
    kit = Image.new("RGBA", (1024, 768), (0, 0, 0, 0))
    boxes: dict = {}
    draw = ImageDraw.Draw(kit)
    keep = keep_hud_swatches()
    cream = keep.get("cream")
    khaki = keep.get("khaki")
    slate = keep.get("slate")
    timber = keep.get("timber")

    def plaque(name: str, x: int, y: int, w: int, h: int, kind: str = "slate") -> None:
        if kind == "wood":
            swatch, fill, light, dark = timber or khaki, WOOD, WOOD_LT, WOOD_DK
        elif kind == "pulp":
            swatch, fill, light, dark = khaki or cream, (168, 158, 118), (214, 204, 168), (110, 100, 72)
        else:
            swatch, fill, light, dark = slate or khaki, FOREST, SLATE_LT, SLATE_DK
        c = 6 if min(w, h) > 40 else 4
        outer = _chamfer(x, y, w, h, c)
        _paint_keep_face(kit, outer, x, y, w, h, swatch, fill)
        draw.polygon(outer, outline=BRASS + (230,))
        frame = 5 if min(w, h) > 48 else 3
        inner = _chamfer(x + frame, y + frame, w - 2 * frame, h - 2 * frame, max(2, c - 2))
        _paint_keep_face(
            kit,
            inner,
            x + frame,
            y + frame,
            w - 2 * frame,
            h - 2 * frame,
            swatch,
            fill,
        )
        draw.line([(x + c, y + 2), (x + w - c, y + 2)], fill=light + (220,), width=2)
        draw.line([(x + 2, y + c), (x + 2, y + h - c)], fill=light + (200,), width=2)
        draw.line([(x + c, y + h - 2), (x + w - c, y + h - 2)], fill=dark + (230,), width=2)
        draw.line([(x + w - 2, y + c), (x + w - 2, y + h - c)], fill=dark + (230,), width=2)
        draw.polygon(_chamfer(x + 5, y + 5, w - 10, h - 10, max(3, c - 2)), outline=BRASS_DK + (90,))
        for rx, ry in ((x + 9, y + 9), (x + w - 10, y + 9), (x + 9, y + h - 10), (x + w - 10, y + h - 10)):
            if w > 28 and h > 28:
                _rivet(draw, rx, ry, 3 if min(w, h) > 50 else 2)
        if kind == "wood" and h > 60:
            draw.rectangle((x + 18, y + 4, x + w - 18, y + 11), fill=BRASS + (255,), outline=BRASS_DK + (255,))
        if kind == "pulp":
            for line_y in range(y + 18, y + h - 8, 14):
                draw.line([(x + 12, line_y), (x + w - 12, line_y)], fill=(140, 128, 88, 90), width=1)
        boxes[name] = {"x": x, "y": y, "w": w, "h": h}

    plaque("plate", 8, 8, 250, 78, "wood")
    plaque("status", 270, 8, 320, 62, "slate")
    plaque("mass", 600, 8, 186, 44, "slate")
    plaque("card", 8, 100, 330, 260, "wood")
    plaque("census", 8, 380, 900, 120, "pulp")
    plaque("minimap", 350, 100, 200, 140, "slate")
    plaque("toast", 8, 520, 360, 48, "slate")
    plaque("btn", 580, 100, 92, 36, "slate")
    plaque("btn-wide", 580, 148, 140, 36, "slate")
    plaque("btn-sq", 580, 196, 46, 46, "slate")
    dpad_pts = _chamfer(740, 100, 150, 150, 28)
    _paint_keep_face(kit, dpad_pts, 740, 100, 150, 150, slate or khaki, FOREST)
    draw.polygon(dpad_pts, outline=BRASS + (230,))
    draw.polygon(_chamfer(752, 112, 126, 126, 22), outline=BRASS_DK + (120,))
    for rx, ry in ((756, 116), (874, 116), (756, 234), (874, 234)):
        _rivet(draw, rx, ry, 3)
    boxes["dpad"] = {"x": 740, "y": 100, "w": 150, "h": 150}
    compass = []
    for i in range(8):
        ang = math.radians(22.5 + i * 45)
        compass.append((960 + 46 * math.cos(ang), 58 + 46 * math.sin(ang)))
    _paint_keep_face(kit, compass, 910, 8, 100, 100, slate or khaki, FOREST)
    draw.polygon(compass, outline=BRASS + (240,))
    draw.ellipse((930, 28, 990, 88), outline=BRASS_DK + (200,))
    draw.polygon([(960, 22), (966, 48), (960, 44), (954, 48)], fill=BRASS)
    boxes["compass"] = {"x": 910, "y": 8, "w": 100, "h": 100}
    plaque("rail", 740, 260, 130, 220, "wood")
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
        place("city-hall", restyle_jane_odd(hall), 200, 200)
    church = extract_last_building(SRC2 / "PC _ Computer - Jane's Realty - Buildings - Church.png", "teal")
    if church:
        place("odd-2", restyle_jane_odd(church), 180, 220)
    store = extract_last_building(SRC2 / "PC _ Computer - Jane's Realty - Buildings - Store.png", "teal")
    if store and not is_gray_pad(store) and not is_fragment(store) and store.height > 90:
        place("odd-3", store, 180, 200)
    maps = SRC2 / "PC _ Computer - Jane's Realty - Map - Map Elements.png"
    if maps.exists():
        mill = key_teal(open_rgba(maps).crop((6, 6, 118, 128)))
        mill = key_color(mill, lambda r, g, b: g > r + 18 and g > b + 12 and g > 70, grow=1)
        mill = trim(mill)
        if mill.getbbox() and mill.height > 50 and not is_gray_pad(mill):
            place("odd-4", restyle_jane_odd(restyle(mill, sat=0.62)), 160, 160)

    if ATTACHED.exists():
        att = open_rgba(ATTACHED)
        bank = extract_last_building(ATTACHED, "mauve")
        if bank:
            place("bank-office", bank, 180, 200)
        # Four left-column stages only (pad → posts → roof → unfinished shell).
        # The finished $ bank is bank-office, never a scaffold.
        for i, st in enumerate(extract_construction(att, "mauve")[:4]):
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
        place("odd-6", restyle_jane_odd(villa), 180, 200)

    ground = OUT / "v5-ground-tiles-kit-k1.png"
    if ground.exists():
        g = open_rgba(ground)
        for name, (x, y, w, h) in GROUND_CROPS.items():
            crop = trim(g.crop((x, y, x + w, y + h)))
            if crop.getbbox():
                spr = restyle(crop, sat=0.52 if name.startswith("plant") else 0.62)
                place(name, spr, 90 if name.startswith("plant") else 72, 110 if name.startswith("plant") else 48)

    for i, tile in enumerate(extract_bike_road()[:8]):
        if tile.width < 20:
            continue
        # Keep iso diamonds; drop tiny specks and photoreal leftovers.
        if tile.height > 70:
            continue
        place(f"bike-{i}", tile, 72, 42)

    civic.save(OUT / "civic-kit-k1.png")
    stamp_civic_distinct_odds()
    pack_large_street_tiles(civic_boxes)

    kit, hud_boxes = hud_kit()
    kit.save(OUT / "hud-kit-k1.png")
    return civic_boxes, hud_boxes


# Scaffold boxes only. Road/bike leftovers at 507 were superseded by the
# packed 640-row tiles; boosting those coords would clobber other civics.
READABILITY_BOXES = dict(SCAFFOLD_BOXES)


def iso_diamond(
    width: int,
    height: int,
    fill: tuple[int, int, int],
    edge: tuple[int, int, int],
    dash: tuple[int, int, int] | None = None,
    chevrons: bool = False,
) -> Image.Image:
    """Readable isometric pavement tile (not a 4px speck)."""
    im = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    cx, cy = width / 2, height / 2
    pts = [(cx, 2), (width - 3, cy), (cx, height - 3), (3, cy)]
    draw.polygon(pts, fill=fill + (255,), outline=edge + (255,))
    if dash:
        draw.line([(cx - width * 0.22, cy - 2), (cx + width * 0.22, cy + 2)], fill=dash + (240,), width=4)
        draw.line([(cx - width * 0.18, cy + 6), (cx + width * 0.18, cy + 10)], fill=dash + (180,), width=2)
    if chevrons and dash:
        for t in (0.24, 0.50, 0.76):
            px = cx + (t - 0.5) * width * 0.52
            py = cy + (t - 0.5) * height * 0.22
            draw.polygon(
                [(px - 20, py + 3), (px - 1, py - 11), (px + 22, py + 3), (px - 1, py + 13)],
                fill=dash + (240,),
            )
    return im


def pack_large_street_tiles(civic_boxes: dict | None = None, path: Path = OUT / "civic-kit-k1.png") -> dict:
    """Park full-size v5 road tiles + drawn bike diamonds on the civic kit."""
    kit = open_rgba(path)
    ground = open_rgba(OUT / "v5-ground-tiles-kit-k1.png")
    boxes = {
        "road-0": (8, 640, 146, 96),
        "road-1": (162, 640, 144, 97),
        "bike-0": (320, 640, 120, 70),
        "bike-1": (448, 640, 120, 70),
    }
    road0 = restyle(trim(ground.crop((26, 182, 26 + 146, 182 + 96))), sat=0.62, contrast=1.08)
    road1 = restyle(trim(ground.crop((190, 181, 190 + 144, 181 + 97))), sat=0.62, contrast=1.08)
    kit.paste(road0, (8, 640 + 96 - road0.height))
    kit.paste(road1, (162, 640 + 97 - road1.height))
    # Packed catalog khaki haul path + cream chevrons (0x948e60 family, not neon lime).
    bike0 = iso_diamond(120, 70, (168, 156, 104), CREAM, (236, 227, 184), chevrons=True)
    bike1 = iso_diamond(120, 70, (150, 140, 92), (232, 224, 198), (236, 227, 184), chevrons=True)
    kit.paste(bike0, (320, 640), bike0)
    kit.paste(bike1, (448, 640), bike1)
    kit.save(path)
    if civic_boxes is not None:
        for name, (x, y, w, h) in boxes.items():
            civic_boxes[name] = {"x": x, "y": y, "w": w, "h": h}
    print("packed large street tiles", boxes)
    return boxes


def boost_civic_readability(path: Path = OUT / "civic-kit-k1.png") -> None:
    """Re-stamp construction stages from the attached sheet; boxes stay put."""
    if ATTACHED.exists():
        stamp_scaffold_frames(path)
        return
    kit = open_rgba(path)
    for name, (x, y, w, h) in READABILITY_BOXES.items():
        crop = restyle_scaffold(kit.crop((x, y, x + w, y + h)).copy())
        kit.paste(crop, (x, y))
        print("boosted", name)
    kit.save(path)


# Civic boxes whose foliage still arrived chartreuse after the first sat crush.
FOLIAGE_BOXES = {
    "office": (8, 8, 420, 303),
    "plant-0": (1375, 319, 74, 101),
    "plant-1": (8, 507, 73, 101),
    "plant-2": (89, 507, 61, 107),
    "plant-3": (158, 507, 57, 105),
    "plant-5": (223, 507, 90, 65),
    "odd-2": (588, 8, 171, 202),
    "odd-3": (767, 8, 144, 139),
    "odd-4": (919, 8, 108, 122),
    "odd-6": (1208, 319, 159, 157),
}


OLIVE = (108, 114, 78)
SLATE_TEAL = (106, 138, 136)


def crush_rgba_pixels(im: Image.Image, water: bool = False) -> Image.Image:
    """Pull neon lime / chartreuse / cyan toward olive-cream-slate. Boxes stay put."""
    out = im.copy()
    px = out.load()
    target = SLATE_TEAL if water else OLIVE
    for yy in range(out.height):
        for xx in range(out.width):
            r, g, b, a = px[xx, yy]
            if a < 16:
                continue
            sat = max(r, g, b) - min(r, g, b)
            yellow = g > r + 18 and b < 55
            neon = g > r + 22 and g > b + 16 and sat > 48
            cyan = b > r + 18 and g > r + 8 and sat > 40
            if not (yellow or neon or cyan):
                continue
            if water and cyan and not neon:
                t = min(1.0, (sat - 24) / 70)
                t = max(0.40, t)
                mix = SLATE_TEAL
            else:
                t = min(1.0, ((sat - 36) / 70) if neon or cyan else 0.72)
                t = max(0.35, t)
                mix = target if water else OLIVE
            px[xx, yy] = (
                int(r * (1 - 0.50 * t) + mix[0] * 0.50 * t),
                int(g * (1 - 0.62 * t) + mix[1] * 0.62 * t),
                int(b * (1 - 0.55 * t) + mix[2] * 0.55 * t),
                a,
            )
    return out


def crush_catalog_vibe(path: Path = OUT / "civic-kit-k1.png") -> None:
    """Pull leftover neon greens on office/plants/odds toward olive-cream-slate."""
    kit = open_rgba(path)
    for name, (x, y, w, h) in FOLIAGE_BOXES.items():
        crop = crush_rgba_pixels(kit.crop((x, y, x + w, y + h)))
        kit.paste(crop, (x, y))
    kit.save(path)
    print("crushed catalog vibe on", ", ".join(FOLIAGE_BOXES), "→", path)


GROUND_VIBE_BOXES = {
    "grassA": (22, 35, 165, 106),
    "grassB": (210, 35, 163, 107),
    "grassC": (394, 35, 165, 107),
    "grassD": (1089, 184, 152, 99),
    "dualGrassA": (24, 317, 246, 96),
    "dualGrassB": (301, 317, 253, 96),
    "parkGrass": (224, 450, 166, 110),
    "treeRoundA": (49, 588, 74, 101),
    "treeRoundB": (181, 588, 73, 101),
    "pineA": (314, 582, 61, 107),
    "pineB": (442, 584, 57, 105),
    "bushA": (547, 612, 104, 76),
}

GROUND_WATER_BOXES = {
    "waterTile": (905, 320, 151, 99),
}


def crush_ground_vibe(path: Path = OUT / "v5-ground-tiles-kit-k1.png") -> None:
    """Restyle lot-pad grass, park trees, and water on the v5 ground kit."""
    kit = open_rgba(path)
    for name, (x, y, w, h) in GROUND_VIBE_BOXES.items():
        kit.paste(crush_rgba_pixels(kit.crop((x, y, x + w, y + h))), (x, y))
    for name, (x, y, w, h) in GROUND_WATER_BOXES.items():
        kit.paste(crush_rgba_pixels(kit.crop((x, y, x + w, y + h)), water=True), (x, y))
    kit.save(path)
    print("crushed ground vibe", ", ".join({**GROUND_VIBE_BOXES, **GROUND_WATER_BOXES}), "→", path)


CIVIC_FOLIAGE = (118, 132, 86)


def crush_canopy_to_civic(im: Image.Image) -> Image.Image:
    """Lift leftover dark-chartreuse canopy onto the civic plant olive."""
    out = im.copy()
    px = out.load()
    for yy in range(out.height):
        for xx in range(out.width):
            r, g, b, a = px[xx, yy]
            if a < 16:
                continue
            foliage = g > r + 6 and g > b and g > 55
            if not foliage:
                continue
            t = 0.72 if g > r + 18 else 0.58
            px[xx, yy] = (
                int(r * (1 - t) + CIVIC_FOLIAGE[0] * t),
                int(g * (1 - t) + CIVIC_FOLIAGE[1] * t),
                int(b * (1 - t) + CIVIC_FOLIAGE[2] * t),
                a,
            )
    return out


def crush_wild_vibe() -> None:
    """Restyle raw wild-tree / bush sheets onto the catalog olive (boxes unchanged)."""
    for name in ("v8-wild-trees-k1.png", "v8-wild-bushes-k1.png"):
        path = OUT / name
        if not path.exists():
            continue
        im = crush_canopy_to_civic(crush_rgba_pixels(open_rgba(path)))
        if "bush" in name:
            im = crush_canopy_to_civic(crush_rgba_pixels(im))
        im.save(path)
        print("crushed wild vibe", path)


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
    stamp_catalog_roofs()
    stamp_diversify_villas()
    stamp_break_clone_clusters()
    stamp_pagoda_vibe()
    stamp_break_catalog_trios()
    stamp_break_cousin_clusters()

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
                "Construction-city HUD: KEEP-textured cream/khaki/slate plaques from restyled scaffold/gate/parking/bank (not Jane chrome, not flat fills)",
                "Jane's houses only after saturation crush",
                "Inland odds are civic-distinct attached footprints (fence, parking, stacked gates, timber loading shed, civic kiosk) — not ChatGPT lot houses and not a second parking pad",
                "Catalog terracotta roofs remapped to umber/slate/olive/clay families (not one house)",
                "White-solar villa clones among lots 11–50 swapped for unused AXP family-sheet industrial silhouettes (crane/foundry/lab/factory) — stamps, not tints",
                "Sheet-1 extras that stacked S/M/L catalog DNA into 5+ families replaced with unused KEEP stamps (solarpunk lighthouse/mill/clock, craft kiln/chimney/pottery/loom, Jane Quonset/store) — stamps, not tints",
                "Remaining catalog S/M/L trios keep one original size; extras use unused KEEP (spa/workshop/mill/temple/church/hall/cottage/norwood + eco observatory/helipad/orchard/conservatory)",
                "Leftover mill/clock/eco-white/ranch cousins keep one of each family; extras use unused KEEP (greenhouse, Dutch mill, Spanish villa, restyled src1/src3 finished exteriors)",
                "Temple cousins 9/17 keep one pagoda (lot 17); lot 9 is a restyled Tudor exterior, not a second eave stack",
                "Boxy lots 8/22/47 keep original commercial 8; 22 is a log cabin (roof-tree dropped) and 47 a pitched duplex, not one cube species",
                "Lot 17 pagoda restyled to slate/timber catalog vibe; silhouette stays an odd original",
                "Lettered family-sheet poster faces (AIE / OPEN SOURCE / CLEAN COMPUTE) flattened onto cream/khaki walls",
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
                "Jane church/villa/cottage as unused civic odds",
                "AXP family-sheet lot-clones as unused civic odds",
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

    if "--hud-only" in sys.argv:
        kit, hud_boxes = hud_kit()
        kit.save(OUT / "hud-kit-k1.png")
        existing = {}
        if MANIFEST.joinpath("tileset-manifest.json").exists():
            existing = json.loads(MANIFEST.joinpath("tileset-manifest.json").read_text())
        existing["hud"] = hud_boxes
        MANIFEST.joinpath("tileset-manifest.json").write_text(json.dumps(existing, indent=2))
        print("hud", len(hud_boxes), OUT / "hud-kit-k1.png")
    elif "--street-tiles" in sys.argv:
        existing = {}
        if MANIFEST.joinpath("tileset-manifest.json").exists():
            existing = json.loads(MANIFEST.joinpath("tileset-manifest.json").read_text())
        boxes = pack_large_street_tiles(existing.get("civic"))
        if "civic" in existing:
            existing["civic"].update({k: {"x": v[0], "y": v[1], "w": v[2], "h": v[3]} for k, v in boxes.items()})
            MANIFEST.joinpath("tileset-manifest.json").write_text(json.dumps(existing, indent=2))
    elif "--catalog-vibe" in sys.argv:
        existing = {}
        if MANIFEST.joinpath("tileset-manifest.json").exists():
            existing = json.loads(MANIFEST.joinpath("tileset-manifest.json").read_text())
        boxes = pack_large_street_tiles(existing.get("civic"))
        crush_catalog_vibe()
        kit, hud_boxes = hud_kit()
        kit.save(OUT / "hud-kit-k1.png")
        if "civic" in existing:
            existing["civic"].update({k: {"x": v[0], "y": v[1], "w": v[2], "h": v[3]} for k, v in boxes.items()})
        existing["hud"] = hud_boxes
        MANIFEST.joinpath("tileset-manifest.json").write_text(json.dumps(existing, indent=2))
        print("catalog vibe restyle", boxes, "hud", len(hud_boxes))
    elif "--wild-vibe" in sys.argv:
        crush_wild_vibe()
        crush_ground_vibe()
        print("wild + ground vibe restyle")
    elif "--boost-civic" in sys.argv:
        boost_civic_readability()
    elif "--stamp-scaffolds" in sys.argv:
        stamp_scaffold_frames()
    elif "--stamp-jane-odds" in sys.argv:
        stamp_jane_odd_frames()
    elif "--stamp-catalog-odds" in sys.argv or "--stamp-civic-odds" in sys.argv:
        stamp_civic_distinct_odds()
    elif "--stamp-catalog-roofs" in sys.argv:
        stamp_catalog_roofs()
    elif "--stamp-villa-diversity" in sys.argv:
        stamp_diversify_villas()
    elif "--stamp-clone-break" in sys.argv:
        stamp_break_clone_clusters()
    elif "--stamp-trio-break" in sys.argv:
        stamp_break_catalog_trios()
    elif "--stamp-cousin-break" in sys.argv:
        stamp_break_cousin_clusters()
    elif "--stamp-jane-windmill" in sys.argv:
        stamp_jane_windmill()
    elif "--crush-lot-sat" in sys.argv:
        crush_stamped_lot_chroma(24, 26.0)
    elif "--stamp-pagoda" in sys.argv:
        stamp_pagoda_vibe()
    elif "--civic-only" in sys.argv:
        civic_boxes, hud_boxes = write_civic_and_hud()
        existing = {}
        if MANIFEST.joinpath("tileset-manifest.json").exists():
            existing = json.loads(MANIFEST.joinpath("tileset-manifest.json").read_text())
        existing["civic"] = civic_boxes
        existing["hud"] = hud_boxes
        MANIFEST.mkdir(parents=True, exist_ok=True)
        MANIFEST.joinpath("tileset-manifest.json").write_text(json.dumps(existing, indent=2))
        boost_civic_readability()
        crush_catalog_vibe()
        stamp_civic_distinct_odds()
        print("civic", len(civic_boxes), "hud", len(hud_boxes))
        for k, v in civic_boxes.items():
            print(k, v)
    else:
        main()
