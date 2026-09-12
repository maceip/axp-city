import {
  box,
  pitchedRoof,
  type Palette,
  windowsLeft,
  windowsRight,
} from "./iso.js";
import { paletteForBuilding } from "./palettes.js";

function mass(
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  p: Palette,
  wr = 0,
  wc = 0,
  wl = 0,
  wcl = 0,
): string {
  let s = box(x, y, z, w, d, h, { top: p.roof, left: p.mid, right: p.dark });
  if (wr && wc) s += windowsRight(x, y, z, w, d, h, wr, wc, p.window);
  if (wl && wcl) s += windowsLeft(x, y, z, w, d, h, wl, wcl, p.window);
  return s;
}

function door(x: number, y: number, z: number, p: Palette): string {
  return box(x, y, z, 0.22, 0.08, 8, {
    top: p.frame,
    left: p.dark,
    right: "#3d4a56",
  });
}

function chimney(x: number, y: number, z: number, p: Palette): string {
  return box(x, y, z, 0.16, 0.16, 8, {
    top: p.accent,
    left: p.dark,
    right: p.mid,
  });
}

function drawSmall(id: number, x: number, y: number, p: Palette): string {
  switch (id) {
    case 1:
      return (
        mass(x + 0.25, y + 0.35, 0, 1.5, 1.2, 16, p) +
        pitchedRoof(x + 0.15, y + 0.25, 16, 1.7, 1.4, 8, p.roofDark, p.roof)
      );
    case 2:
      return (
        mass(x + 0.2, y + 0.3, 0, 1.7, 1.3, 18, p, 2, 1, 2, 1) +
        pitchedRoof(x + 0.1, y + 0.2, 18, 1.9, 1.5, 7, p.roofDark, p.roof)
      );
    case 3:
      return (
        mass(x + 0.15, y + 0.25, 0, 1.8, 1.4, 22, p, 3, 1, 2, 1) +
        box(x + 0.15, y + 0.25, 22, 1.8, 1.4, 4, {
          top: p.roof,
          left: p.accent,
          right: p.dark,
        }) +
        door(x + 1.7, y + 0.85, 0, p)
      );
    case 4:
      return (
        mass(x + 0.2, y + 0.25, 0, 1.7, 1.4, 24, p, 3, 2, 2, 2) +
        box(x + 0.2, y + 0.25, 24, 1.7, 1.4, 3, {
          top: p.roof,
          left: p.wall,
          right: p.dark,
        })
      );
    case 5:
      return (
        mass(x + 0.45, y + 0.35, 0, 1.2, 1.2, 28, p, 2, 3, 2, 3) +
        box(x + 0.45, y + 0.35, 28, 1.2, 1.2, 3, {
          top: p.roofDark,
          left: p.mid,
          right: p.dark,
        })
      );
    case 6:
      return mass(x + 0.4, y + 0.4, 0, 1.2, 1.2, 22, p, 2, 2, 2, 2);
    case 7:
      return (
        mass(x + 0.1, y + 0.35, 0, 1.9, 1.2, 16, p, 4, 1, 2, 1) +
        pitchedRoof(x + 0.05, y + 0.28, 16, 2.0, 1.35, 6, p.roofDark, p.roof)
      );
    case 8:
      return mass(x + 0.35, y + 0.35, 0, 1.35, 1.35, 24, p, 2, 2, 2, 2);
    case 9:
      return (
        mass(x + 0.25, y + 0.3, 0, 1.55, 1.3, 18, p, 2, 1, 2, 1) +
        pitchedRoof(x + 0.15, y + 0.2, 18, 1.75, 1.5, 10, p.roofDark, p.roof) +
        chimney(x + 1.4, y + 0.55, 22, p)
      );
    case 10:
      return (
        box(x + 0.2, y + 0.35, 0, 1.7, 1.3, 14, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        }) +
        box(x + 0.45, y + 0.5, 14, 1.2, 1.0, 6, {
          top: p.roofDark,
          left: p.dark,
          right: p.mid,
        })
      );
    case 11: {
      let s = "";
      const layers = [
        { i: 0.45, w: 1.15, d: 1.15, h: 8, z: 0 },
        { i: 0.35, w: 1.35, d: 1.35, h: 6, z: 8 },
        { i: 0.5, w: 1.05, d: 1.05, h: 6, z: 14 },
        { i: 0.4, w: 1.25, d: 1.25, h: 5, z: 20 },
      ];
      for (const L of layers) {
        s += box(x + L.i, y + L.i, L.z, L.w, L.d, L.h, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        });
      }
      s += box(x + 0.95, y + 0.95, 25, 0.12, 0.12, 10, {
        top: p.accent,
        left: p.dark,
        right: p.mid,
      });
      return s;
    }
    case 12:
      return (
        box(x + 0.15, y + 0.4, 0, 1.8, 1.15, 14, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        }) +
        box(x + 0.3, y + 0.5, 14, 1.5, 0.95, 6, {
          top: p.roofDark,
          left: p.dark,
          right: p.mid,
        })
      );
    case 13:
      return (
        mass(x + 0.15, y + 0.2, 0, 1.2, 1.55, 14, p, 1, 1, 2, 1) +
        mass(x + 0.15, y + 0.2, 0, 1.85, 0.7, 14, p, 3, 1, 0, 0)
      );
    case 14:
      return (
        mass(x + 0.2, y + 0.25, 0, 1.7, 1.45, 22, p, 3, 2, 2, 2) +
        box(x + 0.2, y + 0.25, 22, 1.7, 1.45, 3, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        })
      );
    case 15:
      return (
        mass(x + 0.25, y + 0.4, 0, 1.55, 1.15, 18, p, 2, 1, 2, 1) +
        pitchedRoof(x + 0.15, y + 0.3, 18, 1.75, 1.35, 10, p.roofDark, p.roof) +
        box(x + 0.9, y + 0.75, 18, 0.28, 0.28, 22, {
          top: p.accent,
          left: p.mid,
          right: p.dark,
        })
      );
    case 16:
      return (
        mass(x + 0.15, y + 0.3, 0, 1.8, 1.35, 16, p, 0, 0, 2, 1) +
        box(x + 1.7, y + 0.55, 0, 0.08, 0.85, 12, {
          top: p.frame,
          left: "#4a5560",
          right: "#3a4450",
        })
      );
    default:
      return (
        mass(x + 0.25, y + 0.25, 0, 1.55, 1.45, 26, p, 2, 2, 2, 2) +
        box(x + 0.25, y + 0.25, 26, 1.55, 1.45, 3, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        })
      );
  }
}

function drawMedium(id: number, x: number, y: number, p: Palette): string {
  switch (id) {
    case 18:
      return mass(x + 0.05, y + 0.2, 0, 2.0, 1.55, 28, p, 4, 2, 3, 2);
    case 19:
      return (
        mass(x + 0.1, y + 0.25, 0, 0.85, 1.45, 48, p, 1, 5, 2, 5) +
        mass(x + 1.15, y + 0.25, 0, 0.85, 1.45, 48, p, 1, 5, 2, 5) +
        mass(x + 0.1, y + 0.55, 0, 1.9, 0.85, 16, p, 3, 1, 0, 0)
      );
    case 20:
      return (
        mass(x + 0.15, y + 0.2, 0, 1.85, 1.55, 32, p, 4, 3, 3, 3) +
        box(x + 0.15, y + 0.2, 32, 1.85, 1.55, 4, {
          top: p.roof,
          left: p.accent,
          right: p.dark,
        })
      );
    case 21:
      return (
        mass(x + 0.1, y + 0.15, 0, 1.95, 1.7, 16, p, 4, 1, 3, 1) +
        mass(x + 0.3, y + 0.3, 16, 1.55, 1.4, 12, p, 3, 1, 2, 1) +
        mass(x + 0.5, y + 0.45, 28, 1.15, 1.1, 10, p, 2, 1, 2, 1)
      );
    case 22:
      return (
        mass(x + 0.15, y + 0.15, 0, 1.85, 1.7, 12, p, 3, 1, 3, 1) +
        mass(x + 0.35, y + 0.35, 12, 1.45, 1.3, 10, p, 2, 1, 2, 1) +
        mass(x + 0.55, y + 0.55, 22, 1.05, 0.9, 10, p, 2, 1, 1, 1)
      );
    case 23:
      return (
        mass(x + 0.1, y + 0.15, 0, 1.2, 1.7, 30, p, 2, 3, 3, 3) +
        mass(x + 0.1, y + 0.15, 0, 2.0, 0.75, 30, p, 4, 3, 0, 0)
      );
    case 24:
      return mass(x + 0.15, y + 0.2, 0, 1.8, 1.55, 34, p, 3, 3, 3, 3);
    case 25:
      return (
        mass(x + 0.1, y + 0.2, 0, 1.95, 1.55, 30, p, 4, 2, 3, 2) +
        box(x + 1.55, y + 0.15, 30, 0.22, 0.22, 8, {
          top: "#d64545",
          left: "#b53636",
          right: "#8f2a2a",
        })
      );
    case 26:
      return (
        mass(x + 0.1, y + 0.2, 0, 1.95, 1.55, 26, p, 4, 2, 3, 2) +
        box(x + 1.7, y + 0.25, 26, 0.16, 0.1, 12, {
          top: p.accent,
          left: p.dark,
          right: p.mid,
        })
      );
    case 27:
      return (
        mass(x + 0.15, y + 0.15, 0, 1.85, 1.7, 28, p, 3, 2, 3, 2) +
        mass(x + 0.55, y + 0.0, 0, 1.05, 0.45, 16, p, 2, 1, 0, 0)
      );
    case 28: {
      let s = "";
      for (let i = 0; i < 4; i++) {
        s += box(x + 0.15, y + 0.2, i * 8, 1.85, 1.55, 6, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        });
      }
      s += mass(x + 1.55, y + 0.35, 0, 0.45, 0.55, 36, p, 1, 4, 1, 4);
      return s;
    }
    case 29:
      return (
        mass(x + 0.1, y + 0.15, 0, 0.75, 1.7, 28, p, 1, 3, 3, 3) +
        mass(x + 1.3, y + 0.15, 0, 0.75, 1.7, 28, p, 1, 3, 3, 3) +
        mass(x + 0.1, y + 1.2, 0, 1.95, 0.65, 16, p, 4, 1, 0, 0)
      );
    case 30:
      return (
        mass(x + 0.1, y + 0.25, 0, 1.95, 1.45, 22, p, 4, 2, 3, 2) +
        box(x + 1.55, y + 0.4, 22, 0.28, 0.28, 14, {
          top: p.roofDark,
          left: p.dark,
          right: p.mid,
        }) +
        box(x + 1.2, y + 0.4, 22, 0.22, 0.22, 10, {
          top: p.roofDark,
          left: p.dark,
          right: p.mid,
        })
      );
    case 31:
      return mass(x + 0.1, y + 0.15, 0, 1.95, 1.7, 32, p, 4, 3, 3, 3);
    case 32:
      return mass(x + 0.2, y + 0.2, 0, 1.7, 1.55, 34, p, 3, 3, 3, 3);
    case 33:
      return (
        mass(x + 0.45, y + 0.25, 0, 1.2, 1.5, 36, p, 2, 4, 2, 4) +
        box(x + 0.45, y + 0.25, 36, 1.2, 1.5, 4, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        })
      );
    default:
      return (
        mass(x + 0.15, y + 0.2, 0, 1.85, 1.55, 28, p, 3, 2, 3, 2) +
        box(x + 0.35, y + 0.35, 28, 1.45, 1.25, 2, {
          top: "#7eb8d4",
          left: p.mid,
          right: p.dark,
        })
      );
  }
}

function drawLarge(id: number, x: number, y: number, p: Palette): string {
  switch (id) {
    case 35:
      return (
        mass(x + 0.55, y + 0.4, 0, 1.0, 1.15, 70, p, 2, 8, 2, 8) +
        box(x + 0.55, y + 0.4, 70, 1.0, 1.15, 4, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        })
      );
    case 36:
      return (
        mass(x + 0.15, y + 0.3, 0, 0.75, 1.35, 62, p, 1, 7, 2, 7) +
        mass(x + 1.2, y + 0.3, 0, 0.75, 1.35, 62, p, 1, 7, 2, 7) +
        mass(x + 0.15, y + 0.7, 40, 1.8, 0.55, 8, p, 3, 1, 0, 0)
      );
    case 37:
      return (
        mass(x + 0.4, y + 0.25, 0, 1.3, 1.5, 58, p, 2, 7, 3, 7) +
        box(x + 0.4, y + 0.25, 58, 1.3, 1.5, 4, {
          top: p.roof,
          left: p.accent,
          right: p.dark,
        })
      );
    case 38:
      return (
        mass(x + 0.15, y + 0.15, 0, 1.85, 1.7, 18, p, 3, 2, 3, 2) +
        mass(x + 0.35, y + 0.3, 18, 1.45, 1.4, 16, p, 2, 2, 2, 2) +
        mass(x + 0.55, y + 0.45, 34, 1.05, 1.1, 16, p, 2, 2, 2, 2) +
        mass(x + 0.75, y + 0.6, 50, 0.65, 0.8, 12, p, 1, 1, 1, 1)
      );
    case 39:
      return (
        mass(x + 0.1, y + 0.15, 0, 1.95, 1.7, 14, p, 4, 1, 3, 1) +
        mass(x + 0.3, y + 0.3, 14, 1.55, 1.4, 12, p, 3, 1, 2, 1) +
        mass(x + 0.5, y + 0.45, 26, 1.15, 1.1, 12, p, 2, 1, 2, 1) +
        mass(x + 0.7, y + 0.6, 38, 0.75, 0.8, 16, p, 1, 2, 1, 2)
      );
    case 40:
      return (
        mass(x + 0.25, y + 0.55, 0, 0.55, 0.55, 20, p) +
        mass(x + 1.3, y + 0.55, 0, 0.55, 0.55, 20, p) +
        box(x + 0.4, y + 0.7, 20, 0.25, 0.25, 42, {
          top: p.accent,
          left: p.mid,
          right: p.dark,
        }) +
        box(x + 1.45, y + 0.7, 20, 0.25, 0.25, 50, {
          top: p.accent,
          left: p.mid,
          right: p.dark,
        }) +
        mass(x + 0.55, y + 0.85, 0, 1.0, 0.7, 16, p, 2, 1, 1, 1)
      );
    case 41: {
      let s = "";
      for (let i = 0; i < 6; i++) {
        const ox = (i % 2) * 0.12;
        s += mass(
          x + 0.45 + ox,
          y + 0.3 + (i % 2) * 0.08,
          i * 10,
          1.15,
          1.3,
          10,
          p,
          2,
          1,
          2,
          1,
        );
      }
      return s;
    }
    case 42:
      return (
        mass(x + 0.05, y + 0.25, 0, 0.7, 1.45, 52, p, 1, 6, 2, 6) +
        mass(x + 1.35, y + 0.25, 0, 0.7, 1.45, 52, p, 1, 6, 2, 6) +
        mass(x + 0.05, y + 0.55, 28, 2.0, 0.85, 8, p, 4, 1, 0, 0)
      );
    case 43:
      return (
        mass(x + 0.05, y + 0.25, 0, 2.05, 1.5, 18, p, 5, 1, 3, 1) +
        box(x + 0.15, y + 0.35, 18, 1.85, 1.3, 10, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        })
      );
    case 44:
      return (
        mass(x + 0.1, y + 0.45, 0, 1.95, 1.2, 20, p, 4, 2, 2, 2) +
        box(x + 0.25, y + 0.2, 0, 0.7, 0.7, 28, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        }) +
        box(x + 1.15, y + 0.2, 0, 0.7, 0.7, 28, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        }) +
        box(x + 0.38, y + 0.33, 28, 0.44, 0.44, 6, {
          top: p.roofDark,
          left: p.dark,
          right: p.mid,
        }) +
        box(x + 1.28, y + 0.33, 28, 0.44, 0.44, 6, {
          top: p.roofDark,
          left: p.dark,
          right: p.mid,
        })
      );
    case 45:
      return (
        mass(x + 0.7, y + 0.7, 0, 0.7, 0.7, 22, p, 1, 2, 1, 2) +
        box(x + 0.88, y + 0.88, 22, 0.34, 0.34, 48, {
          top: p.accent,
          left: p.mid,
          right: p.dark,
        }) +
        box(x + 0.96, y + 0.96, 70, 0.18, 0.18, 10, {
          top: p.roof,
          left: p.dark,
          right: p.mid,
        })
      );
    case 46:
      return (
        mass(x + 0.1, y + 0.15, 0, 1.95, 1.15, 20, p, 4, 2, 2, 2) +
        mass(x + 0.45, y + 0.15, 20, 1.25, 1.7, 28, p, 2, 3, 3, 3)
      );
    case 47:
      return (
        mass(x + 0.65, y + 0.45, 0, 0.8, 1.05, 76, p, 1, 9, 2, 9) +
        box(x + 0.65, y + 0.45, 76, 0.8, 1.05, 4, {
          top: p.roof,
          left: p.mid,
          right: p.dark,
        })
      );
    case 48:
      return (
        mass(x + 0.1, y + 0.15, 0, 1.1, 1.7, 22, p, 2, 2, 3, 2) +
        mass(x + 0.95, y + 0.15, 0, 1.1, 1.1, 18, p, 2, 2, 2, 2) +
        mass(x + 0.55, y + 0.85, 0, 1.5, 1.0, 14, p, 3, 1, 2, 1) +
        box(x + 0.2, y + 0.25, 22, 0.9, 1.5, 2, {
          top: "#6faf62",
          left: p.mid,
          right: p.dark,
        })
      );
    case 49:
      return (
        mass(x + 0.05, y + 0.15, 0, 2.05, 1.7, 24, p, 0, 0, 0, 0) +
        mass(x + 0.35, y + 0.35, 0, 0.7, 0.7, 36, p) +
        mass(x + 1.1, y + 0.9, 0, 0.7, 0.7, 36, p)
      );
    default:
      return (
        mass(x + 0.45, y + 0.3, 0, 1.2, 1.4, 18, p, 2, 2, 2, 2) +
        mass(x + 0.6, y + 0.45, 18, 0.9, 1.1, 22, p, 2, 2, 2, 2) +
        mass(x + 0.75, y + 0.6, 40, 0.6, 0.8, 18, p, 1, 2, 1, 2)
      );
  }
}

export function renderBuilding(
  buildingId: number,
  x: number,
  y: number,
  quiet: boolean,
): string {
  const p = paletteForBuilding(buildingId);
  const muted: Palette = quiet
    ? {
        ...p,
        window: "#5a6d80",
        wall: p.wall,
      }
    : p;
  const body =
    buildingId <= 17
      ? drawSmall(buildingId, x, y, muted)
      : buildingId <= 34
        ? drawMedium(buildingId, x, y, muted)
        : drawLarge(buildingId, x, y, muted);
  return `<g class="building" data-id="${buildingId}">${body}</g>`;
}
