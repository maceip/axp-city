import Phaser from "phaser";
import { project } from "../../src/render/iso.js";
import type { AnimStamp, DiamondOp, EllipseOp, ImageStamp } from "../../src/game/plan.js";
import type { SpriteBox } from "../../src/render/sprites.js";

export const SPRITE_BASE = "/assets/sprites";

export function frameName(box: SpriteBox): string {
  return `${box.x}_${box.y}_${box.w}_${box.h}`;
}

export function ensureFrame(scene: Phaser.Scene, sheet: string, box: SpriteBox): string {
  const name = frameName(box);
  const tex = scene.textures.get(sheet);
  if (!tex.has(name)) {
    tex.add(name, 0, box.x, box.y, box.w, box.h);
  }
  return name;
}

export function drawDiamond(g: Phaser.GameObjects.Graphics, op: DiamondOp): void {
  const p0 = project(op.x, op.y);
  const p1 = project(op.x + op.w, op.y);
  const p2 = project(op.x + op.w, op.y + op.d);
  const p3 = project(op.x, op.y + op.d);
  g.fillStyle(op.fill, op.fillAlpha);
  g.lineStyle(0.6, op.stroke, op.strokeAlpha);
  g.beginPath();
  g.moveTo(p0.sx, p0.sy);
  g.lineTo(p1.sx, p1.sy);
  g.lineTo(p2.sx, p2.sy);
  g.lineTo(p3.sx, p3.sy);
  g.closePath();
  g.fillPath();
  g.strokePath();
}

export function stampImage(scene: Phaser.Scene, stamp: ImageStamp): Phaser.GameObjects.Image {
  const frame = ensureFrame(scene, stamp.sheet, stamp.box);
  const img = scene.add.image(stamp.sx, stamp.sy, stamp.sheet, frame);
  img.setOrigin(0.5, 1);
  img.setScale(stamp.scaleX, stamp.scaleY);
  img.setDepth(stamp.depth);
  if (stamp.dimmed) img.setAlpha(0.62);
  if (stamp.pixelated) {
    img.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  return img;
}

export function stampEllipse(g: Phaser.GameObjects.Graphics, op: EllipseOp): void {
  g.fillStyle(op.fill, op.fillAlpha);
  g.fillEllipse(op.sx, op.sy, op.rx * 2, op.ry * 2);
}

export function stampAnim(scene: Phaser.Scene, stamp: AnimStamp): Phaser.GameObjects.Sprite {
  const cellW = stamp.sheet.width / stamp.sheet.cols;
  const sprite = scene.add.sprite(stamp.sx, stamp.sy, stamp.anim, 0);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(stamp.targetW / cellW);
  sprite.setDepth(stamp.depth);
  const loopDur = stamp.sheet.frames / stamp.sheet.fps;
  const phase = ((stamp.phase % loopDur) + loopDur) % loopDur;
  const startFrame = Math.floor((phase / loopDur) * stamp.sheet.frames) % stamp.sheet.frames;
  sprite.play({ key: stamp.anim, startFrame });

  if (stamp.pace) {
    const legMs = stamp.pace.legs * loopDur * 1000;
    scene.tweens.add({
      targets: sprite,
      x: stamp.sx + stamp.pace.dx,
      y: stamp.sy + stamp.pace.dy,
      duration: legMs,
      yoyo: true,
      repeat: -1,
      ease: "Linear",
      onYoyo: () => sprite.setFlipX(true),
      onRepeat: () => sprite.setFlipX(false),
    });
  }
  if (stamp.bob) {
    scene.tweens.add({
      targets: sprite,
      y: stamp.sy - stamp.bob,
      duration: (loopDur * 1000) / 2,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }
  return sprite;
}

export function diamondContains(x: number, y: number, w: number, d: number, sx: number, sy: number): boolean {
  const pts = [
    project(x, y),
    project(x + w, y),
    project(x + w, y + d),
    project(x, y + d),
  ];
  const poly = new Phaser.Geom.Polygon(pts.flatMap((p) => [p.sx, p.sy]));
  return Phaser.Geom.Polygon.Contains(poly, sx, sy);
}
