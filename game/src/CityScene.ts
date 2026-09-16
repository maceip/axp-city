import Phaser from "phaser";
import type { CityScenePlan } from "../../src/game/plan.js";
import { project } from "../../src/render/iso.js";
import { LOT_D, LOT_W } from "../../src/render/layout.js";
import type { CityLot } from "../../src/types.js";
import { SceneKeys } from "./Boot.js";
import { Hud } from "./hud.js";
import { diamondContains, drawDiamond, stampAnim, stampEllipse, stampImage } from "./stamps.js";

export class CityScene extends Phaser.Scene {
  private hud = new Hud();
  private plan!: CityScenePlan;
  private lots = new Map<string, CityLot>();
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private keys: Record<string, Phaser.Input.Keyboard.Key | undefined> = {};
  private highlight!: Phaser.GameObjects.Graphics;
  private selected?: string;

  constructor() {
    super(SceneKeys.City);
  }

  create(): void {
    this.plan = this.registry.get("plan") as CityScenePlan;
    const lots = this.registry.get("lots") as CityLot[];
    this.lots = new Map(lots.map((lot) => [lot.fullName, lot]));

    const ground = this.add.graphics().setDepth(0);
    for (const diamond of this.plan.diamonds) drawDiamond(ground, diamond);

    const shadows = this.add.graphics().setDepth(6);
    for (const ellipse of this.plan.ellipses) stampEllipse(shadows, ellipse);

    for (const image of this.plan.images) stampImage(this, image);
    for (const anim of this.plan.anims) stampAnim(this, anim);

    this.highlight = this.add.graphics().setDepth(90);

    const cam = this.cameras.main;
    const { world } = this.plan;
    cam.setBounds(world.x, world.y, world.width, world.height);
    cam.setZoom(0.82);
    cam.roundPixels = false;
    const focus = project(this.plan.worldW / 2, this.plan.worldH / 2);
    cam.centerOn(focus.sx, focus.sy);

    this.bindInput();
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setSize(gameSize.width, gameSize.height);
    });
  }

  private bindInput(): void {
    const cam = this.cameras.main;
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.moved = false;
      this.lastX = pointer.x;
      this.lastY = pointer.y;
      this.hud.hideTag();
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const wasDrag = this.moved;
      this.dragging = false;
      if (wasDrag) return;
      const world = cam.getWorldPoint(pointer.x, pointer.y);
      const hit = this.hitAt(world.x, world.y);
      if (!hit) {
        this.selected = undefined;
        this.highlight.clear();
        this.hud.hideCard();
        return;
      }
      this.select(hit, true);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.dragging) {
        if (Math.abs(pointer.x - this.lastX) + Math.abs(pointer.y - this.lastY) > 3) this.moved = true;
        cam.scrollX -= (pointer.x - this.lastX) / cam.zoom;
        cam.scrollY -= (pointer.y - this.lastY) / cam.zoom;
        this.lastX = pointer.x;
        this.lastY = pointer.y;
        this.hud.hideTag();
        return;
      }
      const world = cam.getWorldPoint(pointer.x, pointer.y);
      const hit = this.hitAt(world.x, world.y);
      if (!hit) {
        this.hud.hideTag();
        return;
      }
      const lot = this.lots.get(hit);
      if (lot) {
        const ev = pointer.event;
        const clientX = "clientX" in ev ? ev.clientX : pointer.x;
        const clientY = "clientY" in ev ? ev.clientY : pointer.y;
        this.hud.showTag(lot, clientX, clientY);
      }
    });
    this.input.on(
      "wheel",
      (
        pointer: Phaser.Input.Pointer,
        _over: Phaser.GameObjects.GameObject[],
        _dx: number,
        dy: number,
      ) => {
        const before = cam.getWorldPoint(pointer.x, pointer.y);
        const next = Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1 / 0.9), 0.35, 1.85);
        cam.setZoom(next);
        const after = cam.getWorldPoint(pointer.x, pointer.y);
        cam.scrollX += before.x - after.x;
        cam.scrollY += before.y - after.y;
      },
    );

    const kb = this.input.keyboard;
    if (kb) {
      this.keys = {
        w: kb.addKey("W"),
        a: kb.addKey("A"),
        s: kb.addKey("S"),
        d: kb.addKey("D"),
        up: kb.addKey("UP"),
        left: kb.addKey("LEFT"),
        down: kb.addKey("DOWN"),
        right: kb.addKey("RIGHT"),
        esc: kb.addKey("ESC"),
      };
      kb.on("keydown-ESC", () => {
        this.selected = undefined;
        this.highlight.clear();
        this.hud.hideCard();
        this.hud.hideTag();
      });
    }
  }

  private hitAt(sx: number, sy: number): string | undefined {
    const hits = [...this.plan.hits].sort((a, b) => b.x + b.y - (a.x + a.y));
    for (const hit of hits) {
      if (diamondContains(hit.x, hit.y, hit.w, hit.d, sx, sy)) return hit.repo;
    }
    return undefined;
  }

  private select(repo: string, pan: boolean): void {
    const lot = this.lots.get(repo);
    const place = this.plan.placements.find((p) => p.lot.fullName === repo);
    if (!lot || !place) return;
    this.selected = repo;
    this.hud.showCard(lot);
    this.highlight.clear();
    const p0 = project(place.x, place.y);
    const p1 = project(place.x + LOT_W, place.y);
    const p2 = project(place.x + LOT_W, place.y + LOT_D);
    const p3 = project(place.x, place.y + LOT_D);
    this.highlight.lineStyle(2.5, 0x2457c5, 1);
    this.highlight.beginPath();
    this.highlight.moveTo(p0.sx, p0.sy);
    this.highlight.lineTo(p1.sx, p1.sy);
    this.highlight.lineTo(p2.sx, p2.sy);
    this.highlight.lineTo(p3.sx, p3.sy);
    this.highlight.closePath();
    this.highlight.strokePath();
    if (pan) {
      const mid = project(place.x + LOT_W / 2, place.y + LOT_D / 2);
      this.cameras.main.pan(mid.sx, mid.sy, 450, "Cubic.easeInOut");
    }
  }

  update(_time: number, delta: number): void {
    const cam = this.cameras.main;
    const speed = (420 / cam.zoom) * (delta / 1000);
    if (this.keys.w?.isDown || this.keys.up?.isDown) cam.scrollY -= speed;
    if (this.keys.s?.isDown || this.keys.down?.isDown) cam.scrollY += speed;
    if (this.keys.a?.isDown || this.keys.left?.isDown) cam.scrollX -= speed;
    if (this.keys.d?.isDown || this.keys.right?.isDown) cam.scrollX += speed;
  }
}
