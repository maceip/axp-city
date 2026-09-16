import { buildingBounds } from "../../src/game/geometry.js";
import Phaser from "phaser";
import { planLot } from "../../src/game/plan.js";
import {
  overlaps,
  unproject,
  visibleChunks,
  type Rect,
} from "../../src/game/visibility.js";
import { project } from "../../src/render/iso.js";
import {
  CONSTRUCTION_MS,
  LOT_W,
  LOT_D,
  STRIDE_X,
  STRIDE_Y,
} from "../../src/world/constants.js";
import { districtName, type LotPlacement } from "../../src/world/layout.js";
import type { CityMutation, CitySnapshot } from "../../src/live/protocol.js";
import { SceneKeys } from "./Boot.js";
import { Hud } from "./hud.js";
import { CityConnection } from "./connection.js";
import {
  diamondContains,
  stampAnim,
  stampEllipse,
  stampImage,
} from "./stamps.js";
import { makeChunk, drawCivics, type TerrainChunk } from "./terrain.js";
interface VisibleLot {
  objects: Phaser.GameObjects.GameObject[];
  signature: string;
  bounds: Rect;
  place: LotPlacement;
}
export class CityScene extends Phaser.Scene {
  private citySnapshot!: CitySnapshot;
  private hud!: Hud;
  private connection!: CityConnection;
  private chunks = new Map<string, TerrainChunk>();
  private lots = new Map<string, VisibleLot>();
  private civics: Phaser.GameObjects.GameObject[] = [];
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private selected?: string;
  private following = false;
  private highlight!: Phaser.GameObjects.Graphics;
  private atmosphere!: Phaser.GameObjects.Graphics;
  private weather = 0;
  private move = { x: 0, y: 0 };
  private lastRefresh = -Infinity;
  private lastInputTime = performance.now();
  private drag?: {
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  };
  private pinch?: { distance: number; x: number; y: number };
  private clockOffset = 0;
  constructor() {
    super(SceneKeys.City);
  }
  create(): void {
    this.citySnapshot = this.registry.get("snapshot");
    this.highlight = this.add.graphics().setDepth(100_000);
    this.atmosphere = this.add
      .graphics()
      .setDepth(1_000_000)
      .setScrollFactor(0);
    this.hud = new Hud({
      zoom: (factor) => this.zoomAt(factor),
      home: () => this.home(),
      focus: (repo) => this.focus(repo),
      move: (x, y) => {
        this.following = false;
        this.move = { x, y };
        this.cameras.main.scrollX += (x * 32) / this.cameras.main.zoom;
        this.cameras.main.scrollY += (y * 32) / this.cameras.main.zoom;
      },
      jump: (x, y) => {
        this.following = false;
        this.cameras.main.centerOn(x, y);
      },
      weather: () =>
        ["clear", "cloudy", "drizzle"][(this.weather = (this.weather + 1) % 3)],
    });
    this.connection = new CityConnection(
      (value) => this.snapshot(value),
      (value) => this.mutation(value),
      (status) => this.hud.status(status),
    );
    this.snapshot(this.citySnapshot);
    this.home();
    this.bindInput();
    this.connection.connect();
    this.events.once("shutdown", () => {
      this.connection.close();
      for (const [key] of this.chunks) this.removeChunk(key);
    });
    (window as unknown as { __AXP: unknown }).__AXP = {
      game: this.game,
      diagnostics: () => ({
        version: Phaser.VERSION,
        renderer: this.game.renderer.type,
        revision: this.citySnapshot.revision,
        totalLots: this.citySnapshot.plan.placements.length,
        visibleLots: this.lots.size,
        chunks: this.chunks.size,
        objects: this.children.length,
        zoom: this.cameras.main.zoom,
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
        selected: this.selected,
        mode: this.citySnapshot.mode,
      }),
      snapshot: () => this.citySnapshot,
      screenPoint: (repo: string) => {
        const p = this.citySnapshot.plan.placements.find(
          (p) => p.lot.fullName === repo,
        );
        if (!p) return null;
        const b = buildingBounds(p);
        const view = this.view();
        return {
          x: (b.x + b.width / 2 - view.x) * this.cameras.main.zoom,
          y: (b.y + b.height * 0.6 - view.y) * this.cameras.main.zoom,
        };
      },
    };
  }
  private now(): number {
    return Date.now() + this.clockOffset;
  }
  private snapshot(value: CitySnapshot): void {
    if (value.version !== 1 || !value.plan?.placements)
      throw new Error("Unsupported city snapshot");
    this.citySnapshot = value;
    this.clockOffset = Date.parse(value.serverTime) - Date.now();
    this.hud.update(value);
    this.resetGround();
    this.lastRefresh = -Infinity;
  }
  private mutation(value: CityMutation): void {
    if (value.revision <= this.citySnapshot.revision) return;
    if (value.revision !== this.citySnapshot.revision + 1) {
      this.connection.connect();
      return;
    }
    this.clockOffset = Date.parse(value.serverTime) - Date.now();
    const places = [...this.citySnapshot.plan.placements];
    const i = places.findIndex(
      (p) => p.lot.fullName === value.placement.lot.fullName,
    );
    if (i < 0) places.push(value.placement);
    else places[i] = value.placement;
    this.citySnapshot = {
      ...this.citySnapshot,
      revision: value.revision,
      serverTime: value.serverTime,
      plan: {
        ...this.citySnapshot.plan,
        ...value.geometry,
        placements: places,
      },
    };
    if (value.geometry) this.resetGround();
    this.hud.update(this.citySnapshot);
    if (value.type === "lot_added")
      this.hud.toast(
        `${value.placement.lot.fullName} is building a home in ${value.placement.district}.`,
      );
    this.lastRefresh = -Infinity;
  }
  private destroy(objects: Phaser.GameObjects.GameObject[]): void {
    for (const object of objects) {
      this.tweens.killTweensOf(object);
      object.destroy();
    }
  }
  private removeChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.destroy(chunk.objects);
    this.textures.remove(chunk.texture);
    this.chunks.delete(key);
  }
  private resetGround(): void {
    for (const [key] of this.chunks) this.removeChunk(key);
    this.destroy(this.civics);
    this.civics = drawCivics(this, this.citySnapshot.plan);
  }
  private view(): Rect {
    const c = this.cameras.main;
    return {
      x: c.scrollX + c.width / 2 - c.width / (2 * c.zoom),
      y: c.scrollY + c.height / 2 - c.height / (2 * c.zoom),
      width: c.width / c.zoom,
      height: c.height / c.zoom,
    };
  }
  private refresh(): void {
    const view = this.view(),
      keys = visibleChunks(view),
      needed = new Set(keys.map((k) => k.key));
    for (const [key] of this.chunks)
      if (!needed.has(key)) this.removeChunk(key);
    for (const chunk of keys)
      if (!this.chunks.has(chunk.key))
        this.chunks.set(
          chunk.key,
          makeChunk(this, chunk.x, chunk.y, this.citySnapshot.plan),
        );
    const padded = {
      x: view.x - 200,
      y: view.y - 200,
      width: view.width + 400,
      height: view.height + 400,
    };
    const wanted = new Set<string>();
    const detail = this.cameras.main.zoom >= 0.72;
    for (const place of this.citySnapshot.plan.placements) {
      const bounds = buildingBounds(place),
        anchor = project(place.x + 2, place.y + 1);
      if (
        !overlaps(padded, {
          x: Math.min(bounds.x, anchor.sx - 140),
          y: bounds.y,
          width: Math.max(bounds.width, 280),
          height: bounds.height + 110,
        })
      )
        continue;
      const name = place.lot.fullName;
      wanted.add(name);
      const constructing = Boolean(
        place.addedAt &&
          this.now() - Date.parse(place.addedAt) < CONSTRUCTION_MS,
      );
      const animate =
        detail &&
        overlaps(bounds, {
          x: view.x + view.width * 0.18,
          y: view.y + view.height * 0.18,
          width: view.width * 0.64,
          height: view.height * 0.64,
        });
      const signature =
        JSON.stringify(place.lot) + detail + constructing + animate;
      const previous = this.lots.get(name);
      if (previous?.signature === signature) continue;
      if (previous) this.destroy(previous.objects);
      const ops = planLot(place, detail, this.now());
      const objects: Phaser.GameObjects.GameObject[] = [];
      if (ops.ellipses.length) {
        const shadow = this.add.graphics().setDepth(-99_980);
        for (const op of ops.ellipses) stampEllipse(shadow, op);
        objects.push(shadow);
      }
      for (const op of ops.images) objects.push(stampImage(this, op));
      if (detail || constructing)
        for (const op of ops.anims)
          objects.push(stampAnim(this, op, animate || constructing));
      if (constructing) {
        const scaffold = this.add
          .graphics()
          .setDepth(bounds.y + bounds.height + 2);
        scaffold.lineStyle(2, 0xb89155, 0.95);
        scaffold.strokeRect(
          bounds.x + 12,
          bounds.y + 15,
          bounds.width - 24,
          bounds.height - 15,
        );
        for (let y = bounds.y + 30; y < bounds.y + bounds.height; y += 20)
          scaffold.lineBetween(
            bounds.x + 12,
            y,
            bounds.x + bounds.width - 12,
            y,
          );
        objects.push(scaffold);
      }
      this.lots.set(name, { objects, signature, bounds, place });
      if (
        this.selected === name &&
        !document.getElementById("lot-card")!.hidden
      )
        this.hud.showCard(place);
    }
    for (const [name, lot] of this.lots)
      if (!wanted.has(name)) {
        this.destroy(lot.objects);
        this.lots.delete(name);
      }
    this.drawSelection();
    const center = unproject(view.x + view.width / 2, view.y + view.height / 2);
    const b = this.citySnapshot.plan.bounds;
    const developed =
      center.x >= b.minX &&
      center.x <= b.maxX &&
      center.y >= b.minY &&
      center.y <= b.maxY;
    this.hud.camera(
      view,
      this.cameras.main.zoom,
      developed
        ? districtName(
            Math.floor(center.x / STRIDE_X),
            Math.floor(center.y / STRIDE_Y),
          )
        : "The Wilds",
      center.x,
      center.y,
    );
  }
  private drawSelection(): void {
    this.highlight.clear();
    const p = this.citySnapshot.plan.placements.find(
      (p) => p.lot.fullName === this.selected,
    );
    if (!p) return;
    const points = [
      project(p.x, p.y),
      project(p.x + LOT_W, p.y),
      project(p.x + LOT_W, p.y + LOT_D),
      project(p.x, p.y + LOT_D),
    ].map((p) => new Phaser.Math.Vector2(p.sx, p.sy));
    this.highlight.lineStyle(2, 0xf6dd91, 0.9).strokePoints(points, true);
  }
  private home(): void {
    this.following = false;
    const center = project(3.5, 2);
    this.cameras.main.setZoom(innerWidth < 700 ? 0.9 : 1);
    this.cameras.main.centerOn(center.sx, center.sy);
  }
  private frameLot(place: LotPlacement): void {
    const camera = this.cameras.main,
      bounds = buildingBounds(place);
    const small = camera.width < 700;
    const targetX = small ? camera.width / 2 : (camera.width - 320) / 2;
    const cardTop = document
      .getElementById("lot-card")!
      .getBoundingClientRect().top;
    const targetY = small
      ? Math.max(190, (165 + cardTop) / 2)
      : camera.height / 2;
    camera.pan(
      bounds.x + bounds.width / 2 + (camera.width / 2 - targetX) / camera.zoom,
      bounds.y +
        bounds.height * 0.55 +
        (camera.height / 2 - targetY) / camera.zoom,
      350,
      "Cubic.easeInOut",
    );
  }
  private focus(repo: string): void {
    const place = this.citySnapshot.plan.placements.find(
      (p) => p.lot.fullName.toLowerCase() === repo.toLowerCase(),
    );
    if (!place) return;
    this.selected = place.lot.fullName;
    this.following = false;
    this.hud.showCard(place);
    this.frameLot(place);
    this.drawSelection();
  }

  private hit(x: number, y: number): LotPlacement | undefined {
    const ordered = [...this.lots.values()].sort(
      (a, b) => b.place.x + b.place.y - (a.place.x + a.place.y),
    );
    return ordered.find(
      ({ place, bounds }) =>
        (x >= bounds.x - 8 &&
          x <= bounds.x + bounds.width + 8 &&
          y >= bounds.y - 5 &&
          y <= bounds.y + bounds.height + 8) ||
        diamondContains(place.x, place.y, LOT_W, LOT_D, x, y),
    )?.place;
  }
  private zoomAt(
    factor: number,
    x = this.cameras.main.width / 2,
    y = this.cameras.main.height / 2,
  ): void {
    const c = this.cameras.main,
      zoom = Phaser.Math.Clamp(c.zoom * factor, 0.45, 1.9);
    const wx = c.scrollX + c.width / 2 + (x - c.width / 2) / c.zoom,
      wy = c.scrollY + c.height / 2 + (y - c.height / 2) / c.zoom;
    c.setZoom(zoom);
    c.scrollX = wx - c.width / 2 - (x - c.width / 2) / zoom;
    c.scrollY = wy - c.height / 2 - (y - c.height / 2) / zoom;
    this.hud.hideTag();
  }
  private bindInput(): void {
    this.input.addPointer(2);
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.following = false;
      this.drag = {
        id: p.id,
        x: p.x,
        y: p.y,
        startX: p.x,
        startY: p.y,
        moved: false,
      };
      this.hud.hideTag();
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const down = this.input.manager.pointers.filter((p) => p.isDown);
      if (down.length >= 2) {
        const [a, b] = down,
          dx = a.x - b.x,
          dy = a.y - b.y,
          distance = Math.hypot(dx, dy),
          x = (a.x + b.x) / 2,
          y = (a.y + b.y) / 2;
        if (this.pinch) {
          this.zoomAt(distance / this.pinch.distance, x, y);
          this.cameras.main.scrollX -=
            (x - this.pinch.x) / this.cameras.main.zoom;
          this.cameras.main.scrollY -=
            (y - this.pinch.y) / this.cameras.main.zoom;
        }
        this.pinch = { distance, x, y };
        if (this.drag) this.drag.moved = true;
        return;
      }
      if (this.pinch) return;
      if (this.drag && p.isDown) {
        const d = this.drag;
        if (Math.hypot(p.x - d.startX, p.y - d.startY) > 5) d.moved = true;
        if (d.moved) {
          this.cameras.main.scrollX -= (p.x - d.x) / this.cameras.main.zoom;
          this.cameras.main.scrollY -= (p.y - d.y) / this.cameras.main.zoom;
        }
        d.x = p.x;
        d.y = p.y;
        return;
      }
      const world = this.cameras.main.getWorldPoint(p.x, p.y),
        hit = this.hit(world.x, world.y);
      if (hit && !p.wasTouch) this.hud.showTag(hit.lot.fullName, p.x, p.y);
      else this.hud.hideTag();
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const wasPinch = Boolean(this.pinch);
      this.pinch = undefined;
      const d = this.drag;
      this.drag = undefined;
      if (wasPinch || !d || d.moved) return;
      const world = this.cameras.main.getWorldPoint(p.x, p.y),
        hit = this.hit(world.x, world.y);
      if (hit) {
        this.selected = hit.lot.fullName;
        this.hud.showCard(hit);
        if (this.cameras.main.width < 700) this.frameLot(hit);
        this.drawSelection();
      } else {
        this.selected = undefined;
        this.hud.hideCard();
        this.highlight.clear();
      }
    });
    this.input.on("pointerupoutside", () => {
      this.drag = undefined;
      this.pinch = undefined;
    });
    this.input.on(
      "wheel",
      (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) =>
        this.zoomAt(Math.exp(-dy * 0.0015), p.x, p.y),
    );
    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT") as typeof this.keys;
      kb.on("keydown", (event: KeyboardEvent) => {
        if (document.activeElement instanceof HTMLInputElement) return;
        if (/^[0-9]$/.test(event.key)) {
          const index = (Number(event.key) + 9) % 10;
          const p = this.citySnapshot.plan.placements[index];
          if (p) this.focus(p.lot.fullName);
        }
        if (event.key.toLowerCase() === "f" && this.selected) {
          this.following = !this.following;
          this.hud.toast(
            this.following ? "Following this lot’s activity" : "Free camera",
          );
        }
        if (event.key === "Escape") {
          this.selected = undefined;
          this.following = false;
          this.hud.hideCard();
          this.highlight.clear();
        }
      });
    }
    const double = () => this.home();
    this.game.canvas.addEventListener("dblclick", double);
    this.events.once("shutdown", () =>
      this.game.canvas.removeEventListener("dblclick", double),
    );
  }
  private air(time: number): void {
    const g = this.atmosphere,
      c = this.cameras.main,
      w = c.width,
      h = c.height,
      t = time / 1000;
    g.clear();
    // Small birds, a passing airliner, and a faint satellite train stay bounded to the viewport.
    g.lineStyle(1, 0x304d42, 0.65);
    for (let i = 0; i < 5; i++) {
      const x = ((t * 13 + i * 85) % (w + 160)) - 80,
        y = 90 + i * 13 + Math.sin(t + i) * 4;
      g.beginPath();
      g.moveTo(x - 5, y + 2);
      g.lineTo(x, y);
      g.lineTo(x + 5, y + 2);
      g.strokePath();
    }
    const px = ((t * 32) % (w + 800)) - 400,
      py = h * 0.24;
    g.fillStyle(0xf1eddc, 0.75);
    g.fillTriangle(px - 15, py + 3, px + 17, py, px - 6, py - 5);
    g.lineStyle(1, 0xf4f3df, 0.25);
    g.lineBetween(px - 18, py, px - 115, py);
    if (t % 90 > 55) {
      g.fillStyle(0xf6f1dc, 0.5);
      for (let i = 0; i < 8; i++)
        g.fillCircle(((t * 15) % (w + 400)) - 200 - i * 13, 40 + i * 3, 1);
    }
    if (this.weather) {
      for (let i = 0; i < 4; i++) {
        const x = ((t * 5 + (i * w) / 3) % (w + 500)) - 250,
          y = h * (0.15 + i * 0.18);
        g.fillStyle(0xf5f5e9, 0.13);
        g.fillEllipse(x, y, 360, 100);
        g.fillEllipse(x + 70, y - 15, 210, 70);
      }
    }
    if (this.weather === 2) {
      g.lineStyle(1, 0xdce9db, 0.3);
      for (let i = 0; i < 65; i++) {
        const x = (i * 93 + t * 27) % w,
          y = (i * 67 + t * 125) % h;
        g.lineBetween(x, y, x - 4, y + 10);
      }
    }
  }
  update(time: number): void {
    const c = this.cameras.main;
    // Phaser smooths/clamps its simulation delta. Camera travel follows wall time,
    // so a slow frame does not make keyboard and D-pad controls crawl.
    const inputTime = performance.now();
    const elapsed = Math.min(inputTime - this.lastInputTime, 500);
    this.lastInputTime = inputTime;
    if (!(document.activeElement instanceof HTMLInputElement)) {
      const x =
        this.move.x +
        (this.keys.D?.isDown || this.keys.RIGHT?.isDown ? 1 : 0) -
        (this.keys.A?.isDown || this.keys.LEFT?.isDown ? 1 : 0);
      const y =
        this.move.y +
        (this.keys.S?.isDown || this.keys.DOWN?.isDown ? 1 : 0) -
        (this.keys.W?.isDown || this.keys.UP?.isDown ? 1 : 0);
      if (x || y) {
        this.following = false;
        c.scrollX += (((x * 420) / c.zoom) * elapsed) / 1000;
        c.scrollY += (((y * 420) / c.zoom) * elapsed) / 1000;
      }
    }
    if (this.following && this.selected) {
      const lot = this.lots.get(this.selected);
      const actor = lot?.objects.find(
        (object) => object instanceof Phaser.GameObjects.Sprite,
      ) as Phaser.GameObjects.Sprite | undefined;
      if (actor) c.centerOn(actor.x, actor.y);
    }
    if (time - this.lastRefresh > 120) {
      this.refresh();
      this.lastRefresh = time;
    }
    this.air(time);
  }
}
