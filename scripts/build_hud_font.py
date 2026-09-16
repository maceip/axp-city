#!/usr/bin/env python3
"""Bake a JetBrains Mono BMFont atlas so HUD labels never use canvas fillText.

Chromium + SwiftShader fillText duplicates the last letters of each word
(CENSUSUS, DESKK). Phaser Text hits that path. BitmapText samples this sheet.

Glyphs are packed from a shared baseline so capitals, lowercase, and punctuation
share one line. yoffset is the AngelCode distance from the line top to the quad
top — the previous atlas inverted that and floated lowercase above the baseline.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "assets" / "fonts" / "JetBrainsMono-Regular.ttf"
OUT = ROOT / "assets" / "city-sprites"
SIZE = 32
PAD = 2
FACE = "hud-ink"


def glyphs() -> list[str]:
    chars = [chr(i) for i in range(32, 127)]
    extra = "·—★↓↑↗…“”°×⌂←→−"
    for ch in extra:
        if ch not in chars:
            chars.append(ch)
    for i in range(160, 256):
        ch = chr(i)
        if ch not in chars:
            chars.append(ch)
    return chars


def main() -> None:
    face = ImageFont.truetype(str(FONT), SIZE)
    ascent, descent = face.getmetrics()
    line_height = ascent + descent + 2
    base = ascent
    cell = SIZE * 2
    items: list[tuple[str, Image.Image, int, int, int]] = []
    for ch in glyphs():
        advance = int(round(face.getlength(ch))) if hasattr(face, "getlength") else SIZE // 2
        if ch == " ":
            blank = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
            items.append((ch, blank, 0, 0, max(1, advance)))
            continue
        canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        ImageDraw.Draw(canvas).text((PAD, base), ch, font=face, fill=(255, 255, 255, 255), anchor="ls")
        bbox = canvas.getbbox()
        if bbox is None:
            blank = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
            items.append((ch, blank, 0, 0, max(1, advance)))
            continue
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - PAD)
        y0 = max(0, y0 - PAD)
        x1 = min(cell, x1 + PAD)
        y1 = min(cell, y1 + PAD)
        crop = canvas.crop((x0, y0, x1, y1))
        items.append((ch, crop, x0 - PAD, y0, advance))

    col_w = max(im.width for _, im, *_ in items) + 1
    row_h = max(im.height for _, im, *_ in items) + 1
    cols = 16
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * col_w, rows * row_h), (0, 0, 0, 0))
    font_xml = ET.Element("font")
    ET.SubElement(font_xml, "info", face=FACE, size=str(SIZE), bold="0", italic="0", charset="", unicode="1")
    ET.SubElement(
        font_xml,
        "common",
        lineHeight=str(line_height),
        base=str(base),
        scaleW=str(sheet.width),
        scaleH=str(sheet.height),
        pages="1",
        packed="0",
    )
    pages = ET.SubElement(font_xml, "pages")
    ET.SubElement(pages, "page", id="0", file="hud-font-k1.png")
    chars_el = ET.SubElement(font_xml, "chars", count=str(len(items)))
    for i, (ch, im, xoff, yoff, advance) in enumerate(items):
        cx, cy = (i % cols) * col_w, (i // cols) * row_h
        sheet.alpha_composite(im, (cx, cy))
        ET.SubElement(
            chars_el,
            "char",
            id=str(ord(ch)),
            x=str(cx),
            y=str(cy),
            width=str(im.width),
            height=str(im.height),
            xoffset=str(xoff),
            yoffset=str(yoff),
            xadvance=str(advance),
            page="0",
            chnl="15",
        )
    ET.SubElement(font_xml, "kernings", count="0")
    png = OUT / "hud-font-k1.png"
    xml = OUT / "hud-font-k1.xml"
    sheet.save(png)
    ET.ElementTree(font_xml).write(xml, encoding="utf-8", xml_declaration=True)
    print("wrote", png, sheet.size, "glyphs", len(items), "line", line_height, "base", base, xml)


if __name__ == "__main__":
    main()
