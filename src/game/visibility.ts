import { project } from "../render/iso.js";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const CHUNK_SIZE = 8;
export function unproject(sx: number, sy: number) {
  return { x: sx / 72 + sy / 36, y: sy / 36 - sx / 72 };
}
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
export function visibleChunks(
  view: Rect,
  margin = 180,
): Array<{ key: string; x: number; y: number }> {
  const r = {
    x: view.x - margin,
    y: view.y - margin,
    width: view.width + margin * 2,
    height: view.height + margin * 2,
  };
  const points = [
    unproject(r.x, r.y),
    unproject(r.x + r.width, r.y),
    unproject(r.x, r.y + r.height),
    unproject(r.x + r.width, r.y + r.height),
  ];
  const minX = Math.floor(Math.min(...points.map((p) => p.x)) / CHUNK_SIZE);
  const maxX = Math.floor(Math.max(...points.map((p) => p.x)) / CHUNK_SIZE);
  const minY = Math.floor(Math.min(...points.map((p) => p.y)) / CHUNK_SIZE);
  const maxY = Math.floor(Math.max(...points.map((p) => p.y)) / CHUNK_SIZE);
  const result = [];
  for (let x = minX; x <= maxX; x++)
    for (let y = minY; y <= maxY; y++) {
      const p = project(x * CHUNK_SIZE, y * CHUNK_SIZE);
      if (
        overlaps(r, {
          x: p.sx - CHUNK_SIZE * 36,
          y: p.sy,
          width: CHUNK_SIZE * 72,
          height: CHUNK_SIZE * 36,
        })
      )
        result.push({ key: `${x},${y}`, x, y });
    }
  return result;
}
