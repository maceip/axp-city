#!/usr/bin/env python3
"""Bake a JetBrains Mono atlas so HUD labels never use canvas fillText.

Chromium + SwiftShader fillText duplicates the last letters of each word
(CENSUSUS, DESKK). Phaser Text hits that path. BitmapText samples this sheet.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "assets" / "fonts" / "JetBrainsMono-Regular.ttf"
OUT = ROOT / "assets" / "city-sprites"
SIZE = 24
PAD = 2


def glyphs() -> list[str]:
    chars = [chr(i) for i in range(32, 127)]
    extra = "·—★↓↑↗…“”°—×⌂"
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
    items: list[tuple[str, Image.Image, int, int, int]] = []
    for ch in glyphs():
        bbox = face.getbbox(ch) if ch != " " else (0, 0, SIZE // 2, SIZE)
        if bbox is None:
            bbox = (0, 0, SIZE // 2, SIZE)
        x0, y0, x1, y1 = bbox
        w, h = max(1, x1 - x0), max(1, y1 - y0)
        im = Image.new("RGBA", (w + PAD * 2, h + PAD * 2), (0, 0, 0, 0))
        ImageDraw.Draw(im).text((PAD - x0, PAD - y0), ch, font=face, fill=(255, 255, 255, 255))
        advance = int(face.getlength(ch)) if hasattr(face, "getlength") else w + 1
        items.append((ch, im, -x0, -y0, advance))

    col_w = max(im.width for _, im, *_ in items) + 1
    row_h = max(im.height for _, im, *_ in items) + 1
    cols = 16
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * col_w, rows * row_h), (0, 0, 0, 0))
    font_xml = ET.Element("font")
    ET.SubElement(font_xml, "info", face="JetBrains Mono", size=str(SIZE))
    ET.SubElement(
        font_xml,
        "common",
        lineHeight=str(SIZE + 6),
        base=str(SIZE),
        scaleW=str(sheet.width),
        scaleH=str(sheet.height),
        pages="1",
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
            yoffset=str(yoff + 4),
            xadvance=str(advance),
            page="0",
            chnl="15",
        )
    png = OUT / "hud-font-k1.png"
    xml = OUT / "hud-font-k1.xml"
    sheet.save(png)
    ET.ElementTree(font_xml).write(xml, encoding="utf-8", xml_declaration=True)
    print("wrote", png, sheet.size, "glyphs", len(items), xml)


if __name__ == "__main__":
    main()
