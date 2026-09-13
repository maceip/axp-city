"""Key near-black sheet backgrounds to transparent alpha.

Wild foliage sheets ship as RGB with a ~black background. The map stamps
them with normal source-over compositing, so the background must be real
transparency.

Method: flood-fill from every border pixel through "ink" pixels
(max channel <= INK), and clear alpha only on reached pixels. Interior
dark cores (trunks, shadow clusters) are not border-connected and survive.

Usage: python3 scripts/key_black.py <sheet.png> [...]
Writes a .bak of each input next to it on first run.
"""

import sys
from collections import deque
from pathlib import Path

from PIL import Image

INK = 16
DUST = 25


def key_sheet(path):
    src = Image.open(path).convert("RGB")
    w, h = src.size
    px = src.load()
    ink = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            if max(r, g, b) <= INK:
                ink[row + x] = 1
    seen = bytearray(w * h)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if ink[i] and not seen[i]:
                seen[i] = 1
                queue.append(i)
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if ink[i] and not seen[i]:
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
            if ink[k] and not seen[k]:
                seen[k] = 1
                queue.append(k)
        if x < w - 1:
            k = j + 1
            if ink[k] and not seen[k]:
                seen[k] = 1
                queue.append(k)
        if y > 0:
            k = j - w
            if ink[k] and not seen[k]:
                seen[k] = 1
                queue.append(k)
        if y < h - 1:
            k = j + w
            if ink[k] and not seen[k]:
                seen[k] = 1
                queue.append(k)
    solid = bytearray(w * h)
    for i in range(w * h):
        if not seen[i]:
            solid[i] = 1
    # Drop isolated dust (specks that survived the threshold): opaque
    # components smaller than DUST keep nothing of value at stamp scale.
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
        sys.exit("usage: key_black.py <sheet.png> [...]")
    for arg in sys.argv[1:]:
        key_sheet(arg)
