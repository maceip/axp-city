/** 2:1 isometric projection shared by the world and Phaser client. */
export const TILE_W = 72;
export const TILE_H = 36;
export interface Pt { sx: number; sy: number }
export function project(x: number, y: number, z = 0): Pt {
  return { sx: (x - y) * TILE_W / 2, sy: (x + y) * TILE_H / 2 - z };
}
