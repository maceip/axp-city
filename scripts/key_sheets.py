"""Key near-white sheet backgrounds to transparent alpha.

Building/yard/prop sheets ship as opaque RGB with a ~white background. The
map stamps them with normal source-over compositing, so the background must
be real transparency — otherwise stamps cannot occlude each other.

Method: flood-fill from every border pixel through "paper" pixels
(min channel >= PAPER), and clear alpha only on reached pixels. Interior
whites (windows, walls, paper sheets on drafting tables) are not
border-connected and survive.
Art content extents are unchanged, so the measured boxes in
src/render/sprites.ts stay valid.

Usage: python3 scripts/key_sheets.py <sheet.png> [...]
Writes a .bak of each input next to it on first run.
"""

import sys
from collections import deque
from pathlib import Path

from PIL import Image

PAPER = 252
DUST = 25


def key_sheet(path):
    src = Image.open(path).convert("RGB")
    w, h = src.size
    px = src.load()
    paper = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            if min(r, g, b) >= PAPER:
                paper[row + x] = 1
    seen = bytearray(w * h)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if paper[i] and not seen[i]:
                seen[i] = 1
                queue.append(i)
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if paper[i] and not seen[i]:
                seen[i] = 1
                queue.append(i)
    reached = 0
    while queue:
        j = queue.popleft()
        reached += 1
        x = j % w
        y = j // w
        if x > 0:
            k = j - 1
            if paper[k] and not seen[k]:
                seen[k] = 1
                queue.append(k)
        if x < w - 1:
            k = j + 1
            if paper[k] and not seen[k]:
                seen[k] = 1
                queue.append(k)
        if y > 0:
            k = j - w
            if paper[k] and not seen[k]:
                seen[k] = 1
                queue.append(k)
        if y < h - 1:
            k = j + w
            if paper[k] and not seen[k]:
                seen[k] = 1
                queue.append(k)
    solid = bytearray(w * h)
    for i in range(w * h):
        if not seen[i]:
            solid[i] = 1
    # Drop isolated dust (background grain that survived the threshold):
    # opaque components smaller than DUST keep nothing of value at stamp
    # scale, while legit detail always connects to a larger art mass.
    keep = bytearray(w * h)
    for i in range(w * h):
        if solid[i] and not keep[i]:
            blob = [i]
            keep[i] = 2  # tentatively marked; 2 == undecided
            for j in blob:
                x = j % w
                y = j // w
                if x > 0 and solid[j - 1] and not keep[j - 1]:
                    keep[j - 1] = 2
                    blob.append(j - 1)
                if x < w - 1 and solid[j + 1] and not keep[j + 1]:
                    keep[j + 1] = 2
                    blob.append(j + 1)
                if y > 0 and solid[j - w] and not keep[j - w]:
                    keep[j - w] = 2
                    blob.append(j - w)
                if y < h - 1 and solid[j + w] and not keep[j + w]:
                    keep[j + w] = 2
                    blob.append(j + w)
            mark = 1 if len(blob) >= DUST else 0
            for j in blob:
                keep[j] = mark
    alpha = Image.frombytes("L", (w, h),
                            bytes(0 if seen[i] or not keep[i] else 255
                                  for i in range(w * h)))
    out = src.convert("RGBA")
    out.putalpha(alpha)
    bak = Path(str(path) + ".bak.png")
    if not bak.exists():
        src.save(bak)
    out.save(path)
    total = w * h
    print(f"{path}: cleared {reached}/{total} px ({100 * reached / total:.1f}%)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: key_sheets.py <sheet.png> [...]")
    for arg in sys.argv[1:]:
        key_sheet(arg)
