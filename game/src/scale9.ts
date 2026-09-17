import Phaser from "phaser";
import type { SpriteBox } from "../../src/render/sprites.js";
import { ensureFrame } from "./stamps.js";

/**
 * Canvas-safe 9-slice plaque. Phaser 4's NineSlice object is WebGL-only;
 * the HUD must draw the same way on the Canvas fallback. Corners stay
 * pixel-sized; edges and the KEEP grain center tile instead of smearing.
 * Distinct from the unused stretch panel — BitmapText ink() stays the HUD copy path.
 */
export class Scale9Plaque extends Phaser.GameObjects.Container {
  private readonly sheet: string;
  private readonly box: SpriteBox;
  private readonly inset: number;
  private readonly parts: Phaser.GameObjects.Image[] = [];
  private ox = 0;
  private oy = 0;
  private dw = 0;
  private dh = 0;

  constructor(scene: Phaser.Scene, sheet: string, box: SpriteBox, inset: number, width: number, height: number) {
    super(scene, 0, 0);
    this.sheet = sheet;
    this.box = box;
    this.inset = inset;
    this.rebuild(width, height);
  }

  setDisplaySize(width: number, height: number): this {
    if (width === this.dw && height === this.dh && this.parts.length) return this;
    return this.rebuild(width, height);
  }

  setOrigin(x: number, y?: number): this {
    this.ox = x;
    this.oy = y ?? x;
    this.applyOrigin();
    return this;
  }

  get partCount(): number {
    return this.parts.length;
  }

  visualFrame(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.x - this.ox * this.width,
      y: this.y - this.oy * this.height,
      width: this.width,
      height: this.height,
    };
  }

  setTint(color: number): this {
    for (const img of this.parts) img.setTint(color);
    return this;
  }

  clearTint(): this {
    for (const img of this.parts) img.clearTint();
    return this;
  }

  private rebuild(width: number, height: number): this {
    for (const img of this.parts) img.destroy();
    this.parts.length = 0;
    const i = Math.max(
      2,
      Math.floor(Math.min(this.inset, width / 2 - 1, height / 2 - 1, this.box.w / 2 - 1, this.box.h / 2 - 1)),
    );
    const sx = [this.box.x, this.box.x + i, this.box.x + this.box.w - i];
    const sy = [this.box.y, this.box.y + i, this.box.y + this.box.h - i];
    const sw = [i, this.box.w - 2 * i, i];
    const sh = [i, this.box.h - 2 * i, i];
    const dx = [0, i, width - i];
    const dy = [0, i, height - i];
    const dw = [i, width - 2 * i, i];
    const dh = [i, height - 2 * i, i];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        this.cover(
          { x: sx[c], y: sy[r], w: sw[c], h: sh[r] },
          dx[c],
          dy[r],
          dw[c],
          dh[r],
          c === 1,
          r === 1,
        );
      }
    }
    this.dw = width;
    this.dh = height;
    this.setSize(width, height);
    this.applyOrigin();
    return this;
  }

  private applyOrigin(): void {
    const ox = -this.width * this.ox;
    const oy = -this.height * this.oy;
    this.iterate((child: Phaser.GameObjects.GameObject) => {
      const img = child as Phaser.GameObjects.Image & { destX?: number; destY?: number };
      if (img.destX === undefined || img.destY === undefined) return;
      img.setPosition(ox + img.destX, oy + img.destY);
    });
  }

  private cover(src: SpriteBox, x: number, y: number, w: number, h: number, tileX: boolean, tileY: boolean): void {
    if (w < 0.5 || h < 0.5 || src.w < 1 || src.h < 1) return;
    const cols = tileX ? scale9TileCount(w, src.w) : 1;
    const rows = tileY ? scale9TileCount(h, src.h) : 1;
    const tw = w / cols;
    const th = h / rows;
    const frame = ensureFrame(this.scene, this.sheet, src);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const img = this.scene.add.image(x + c * tw, y + r * th, this.sheet, frame).setOrigin(0, 0);
        img.setDisplaySize(Math.max(0.01, tw), Math.max(0.01, th));
        if (cols > 1 && c % 2) img.setFlipX(true);
        if (rows > 1 && r % 2) img.setFlipY(true);
        img.disableInteractive();
        (img as Phaser.GameObjects.Image & { destX: number; destY: number }).destX = x + c * tw;
        (img as Phaser.GameObjects.Image & { destY: number }).destY = y + r * th;
        this.add(img);
        this.parts.push(img);
      }
    }
  }
}

export function scale9Inset(box: SpriteBox, width: number, height: number): number {
  const cap = Math.min(box.w, box.h, width, height) / 2 - 1;
  const prefer = Math.min(box.w, box.h) <= 48 ? 8 : Math.min(box.w, box.h) <= 80 ? 12 : 16;
  return Math.max(4, Math.min(prefer, cap));
}

/** Prefer one slightly larger tile over a barcode of repeats. */
export function scale9TileCount(dest: number, src: number): number {
  if (src < 1) return 1;
  const span = dest / src;
  if (span <= 1.9) return 1;
  return Math.max(1, Math.min(32, Math.round(span)));
}

/** Rectangular KEEP plaques. Octagon compass/dpad stay whole images. */
export const SCALE9_FRAMES = new Set([
  "plate",
  "status",
  "mass",
  "card",
  "census",
  "minimap",
  "toast",
  "btn",
  "btn-wide",
  "btn-sq",
  "rail",
  "mast",
]);
