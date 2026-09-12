/** 2:1 isometric helpers. World units are tile squares; z is “up” in pixels. */

export const TILE_W = 72;
export const TILE_H = 36;

export interface Pt {
  sx: number;
  sy: number;
}

export interface Palette {
  wall: string;
  mid: string;
  dark: string;
  roof: string;
  roofDark: string;
  window: string;
  frame: string;
  accent: string;
}

export function project(x: number, y: number, z = 0): Pt {
  return {
    sx: (x - y) * (TILE_W / 2),
    sy: (x + y) * (TILE_H / 2) - z,
  };
}

export function fmt(n: number): string {
  return n.toFixed(1);
}

export function path(points: Pt[], fill: string, stroke?: string, width = 0.7): string {
  const d =
    points
      .map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.sx)},${fmt(p.sy)}`)
      .join(" ") + " Z";
  const s = stroke
    ? ` stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"`
    : "";
  return `<path d="${d}" fill="${fill}"${s}/>`;
}

export function diamond(
  x: number,
  y: number,
  w: number,
  d: number,
  fill: string,
  stroke?: string,
): string {
  return path(
    [
      project(x, y),
      project(x + w, y),
      project(x + w, y + d),
      project(x, y + d),
    ],
    fill,
    stroke ?? "rgba(40,50,40,0.12)",
    0.6,
  );
}

export interface BoxColors {
  top: string;
  left: string;
  right: string;
  stroke?: string;
}

export function box(
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  colors: BoxColors,
): string {
  const t0 = project(x, y, z + h);
  const t1 = project(x + w, y, z + h);
  const t2 = project(x + w, y + d, z + h);
  const t3 = project(x, y + d, z + h);
  const r0 = project(x + w, y, z + h);
  const r1 = project(x + w, y + d, z + h);
  const r2 = project(x + w, y + d, z);
  const r3 = project(x + w, y, z);
  const l0 = project(x, y + d, z + h);
  const l1 = project(x + w, y + d, z + h);
  const l2 = project(x + w, y + d, z);
  const l3 = project(x, y + d, z);
  const stroke = colors.stroke ?? "rgba(30,36,42,0.22)";
  return (
    path([l0, l1, l2, l3], colors.left, stroke) +
    path([r0, r1, r2, r3], colors.right, stroke) +
    path([t0, t1, t2, t3], colors.top, stroke)
  );
}

/** Window grid on the +x (right) face. */
export function windowsRight(
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  cols: number,
  rows: number,
  color: string,
): string {
  let out = "";
  const insetX = w * 0.12;
  const insetZ = h * 0.14;
  const usableY = d * 0.72;
  const usableH = h * 0.62;
  const gapY = usableY * 0.12;
  const gapZ = usableH * 0.16;
  const cellY = (usableY - gapY * (cols - 1)) / cols;
  const cellH = (usableH - gapZ * (rows - 1)) / rows;
  const y0 = y + d * 0.14;
  const z1 = z + h - insetZ;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const yy = y0 + c * (cellY + gapY);
      const zz = z1 - r * (cellH + gapZ) - cellH;
      const p0 = project(x + w, yy, zz + cellH);
      const p1 = project(x + w, yy + cellY, zz + cellH);
      const p2 = project(x + w, yy + cellY, zz);
      const p3 = project(x + w, yy, zz);
      out += path([p0, p1, p2, p3], color);
    }
  }
  void insetX;
  return out;
}

/** Window grid on the +y (left) face. */
export function windowsLeft(
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  cols: number,
  rows: number,
  color: string,
): string {
  let out = "";
  const usableX = w * 0.72;
  const usableH = h * 0.62;
  const gapX = usableX * 0.12;
  const gapZ = usableH * 0.16;
  const cellX = (usableX - gapX * (cols - 1)) / cols;
  const cellH = (usableH - gapZ * (rows - 1)) / rows;
  const x0 = x + w * 0.14;
  const z1 = z + h - h * 0.14;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xx = x0 + c * (cellX + gapX);
      const zz = z1 - r * (cellH + gapZ) - cellH;
      const p0 = project(xx, y + d, zz + cellH);
      const p1 = project(xx + cellX, y + d, zz + cellH);
      const p2 = project(xx + cellX, y + d, zz);
      const p3 = project(xx, y + d, zz);
      out += path([p0, p1, p2, p3], color);
    }
  }
  return out;
}

export function pitchedRoof(
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  rise: number,
  left: string,
  right: string,
): string {
  const ridgeY = y + d / 2;
  const e0 = project(x, y, z);
  const e1 = project(x + w, y, z);
  const r0 = project(x, ridgeY, z + rise);
  const r1 = project(x + w, ridgeY, z + rise);
  const e2 = project(x + w, y + d, z);
  const e3 = project(x, y + d, z);
  return (
    path([e0, e1, r1, r0], right, "rgba(30,36,42,0.25)") +
    path([r0, r1, e2, e3], left, "rgba(30,36,42,0.25)")
  );
}

export function g(id: string, inner: string, extra = ""): string {
  return `<g data-part="${id}"${extra}>${inner}</g>`;
}
