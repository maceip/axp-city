/**
 * UNUSED — isolated leftover. HudScene draws plaques with Scale9Plaque.
 * Do not import this file from CityScene, HudScene, or any live renderer.
 * Stretching the nine faces smears KEEP grain; Scale9 tiles instead.
 */
import Phaser from "phaser";
import type { SpriteBox } from "../../src/render/sprites.js";
import { ensureFrame } from "./stamps.js";

/**
 * Legacy 9-image stretch panel. Not the HUD. Corners keep pixel size; edges
 * and centre smear via setDisplaySize. Phaser 4 NineSlice is WebGL-only.
 */
export class NinePanel extends Phaser.GameObjects.Container {
  private readonly parts: Phaser.GameObjects.Image[] = [];

  constructor(
    scene: Phaser.Scene,
    sheet: string,
    box: SpriteBox,
    private readonly inset: number,
    width: number,
    height: number,
  ) {
    super(scene, 0, 0);
    const i = inset;
    const xs = [box.x, box.x + i, box.x + box.w - i];
    const ws = [i, box.w - 2 * i, i];
    const ys = [box.y, box.y + i, box.y + box.h - i];
    const hs = [i, box.h - 2 * i, i];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const sub = { x: xs[c], y: ys[r], w: ws[c], h: hs[r] };
        const img = scene.add.image(0, 0, sheet, ensureFrame(scene, sheet, sub)).setOrigin(0, 0);
        this.parts.push(img);
        this.add(img);
      }
    }
    this.resize(width, height);
  }

  /** Same contract as `Image.setDisplaySize` for the callers that lay out plaques. */
  setDisplaySize(width: number, height: number): this {
    return this.resize(width, height);
  }

  resize(width: number, height: number): this {
    const i = Math.min(this.inset, width / 2, height / 2);
    const xs = [0, i, width - i];
    const ws = [i, width - 2 * i, i];
    const ys = [0, i, height - i];
    const hs = [i, height - 2 * i, i];
    this.parts.forEach((img, k) => {
      const r = Math.floor(k / 3),
        c = k % 3;
      img.setPosition(xs[c], ys[r]).setDisplaySize(Math.max(0.01, ws[c]), Math.max(0.01, hs[r]));
    });
    this.setSize(width, height);
    return this;
  }
}
