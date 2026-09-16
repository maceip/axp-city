import Phaser from "phaser";
import { ambientActors } from "../../src/game/ambient.js";
import { findPlacement } from "../../src/game/census.js";
import { buildingBounds, buildingSize } from "../../src/game/geometry.js";
import { planLot, type LotRenderPlan } from "../../src/game/plan.js";
import { overlaps, unproject, visibleChunks, type Rect } from "../../src/game/visibility.js";
import type { CityMutation, CitySnapshot } from "../../src/live/protocol.js";
import { project } from "../../src/render/iso.js";
import { LOT_W, LOT_D, STRIDE_X, STRIDE_Y } from "../../src/world/constants.js";
import { districtName, type LotPlacement } from "../../src/world/layout.js";
import { AccessibilityMirror } from "./a11y.js";
import { ActorSystem } from "./actors.js";
import { AssetLoader } from "./assets.js";
import { SceneKeys } from "./Boot.js";
import { CityConnection, type ConnectionState } from "./connection.js";
import { downloadCapture, samplePixels } from "./export.js";
import { HudScene } from "./HudScene.js";
import { graphicsPool, imagePool, type ObjectPool } from "./pool.js";
import { diamondContains, drawDiamond, ensureFrame, stampEllipse } from "./stamps.js";
import { TerrainCache, drawCivics } from "./terrain.js";

interface LotView {
  images: Phaser.GameObjects.Image[];
  shapes: Phaser.GameObjects.Graphics[];
  signature: string;
  bounds: Rect;
  place: LotPlacement;
  /** Some sheet was still loading; rebuild when it arrives. */
  incomplete: boolean;
}

const boundsCache = new WeakMap<LotPlacement, Rect>();
function lotBounds(place: LotPlacement): Rect {
  let b = boundsCache.get(place);
  if (!b) {
    b = buildingBounds(place);
    boundsCache.set(place, b);
  }
  return b;
}

export class CityScene extends Phaser.Scene {
  private city!: CitySnapshot;
  private hud!: HudScene;
  private hudReady = false;
  private mirror?: AccessibilityMirror;
  private connection!: CityConnection;
  private assets!: AssetLoader;
  private actors!: ActorSystem;
  private terrain!: TerrainCache;
  private images!: ObjectPool<Phaser.GameObjects.Image>;
  private shapes!: ObjectPool<Phaser.GameObjects.Graphics>;
  private lots = new Map<string, LotView>();
  private civics: Phaser.GameObjects.GameObject[] = [];
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private selected?: string;
  private followActor?: string;
  private highlight!: Phaser.GameObjects.Graphics;
  private atmosphere!: Phaser.GameObjects.Graphics;
  private weather = 0;
  private move = { x: 0, y: 0 };
  private lastRefresh = -Infinity;
  private lastCamera = "";
  private lastInputTime = performance.now();
  private drag?: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean };
  private pinch?: { distance: number; x: number; y: number };
  private clockOffset = 0;
  private connectionState: ConnectionState = "connecting";
  private frameTimes: number[] = [];
  reducedMotion = false;

  constructor() {
    super(SceneKeys.City);
  }

  create(): void {
    // Scenes are singletons: a restart after a graphics-context loss re-enters
    // create() on the same instance, so per-run state starts clean here.
    this.hudReady = false;
    this.mirror = undefined;
    this.lots = new Map();
    this.civics = [];
    this.selected = undefined;
    this.followActor = undefined;
    this.drag = undefined;
    this.pinch = undefined;
    this.move = { x: 0, y: 0 };
    this.lastRefresh = -Infinity;
    this.lastCamera = "";
    this.frameTimes = [];
    this.connectionState = "connecting";
    this.city = this.registry.get("snapshot");
    this.reducedMotion = this.registry.get("reducedMotion") ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.assets = new AssetLoader(this);
    this.actors = new ActorSystem(this, this.assets);
    this.actors.reducedMotion = this.reducedMotion;
    this.terrain = new TerrainCache(this);
    this.images = imagePool(this, 1500);
    this.shapes = graphicsPool(this, 400);
    this.highlight = this.add.graphics().setDepth(100_000);
    this.atmosphere = this.add.graphics().setDepth(1_000_000).setScrollFactor(0);
    this.assets.onReady(() => {
      for (const view of this.lots.values()) if (view.incomplete) view.signature = "";
      this.lastRefresh = -Infinity;
    });

    const actions = {
      zoom: (factor: number) => this.zoomAt(factor),
      home: () => this.home(),
      select: (repo: string | undefined, frame?: boolean) => this.select(repo, frame ?? true),
      move: (x: number, y: number) => {
        this.stopFollowing();
        this.move = { x, y };
        this.cameras.main.scrollX += (x * 32) / this.cameras.main.zoom;
        this.cameras.main.scrollY += (y * 32) / this.cameras.main.zoom;
      },
      jump: (x: number, y: number) => {
        this.stopFollowing();
        this.cameras.main.centerOn(x, y);
      },
      follow: () => this.toggleFollow(),
      capture: () => this.capture(),
      toggleMotion: () => this.setReducedMotion(!this.reducedMotion),
    };
    this.scene.launch(SceneKeys.Hud, { actions, snapshot: this.city });
    this.hud = this.scene.get(SceneKeys.Hud) as HudScene;
    this.hud.events.once(Phaser.Scenes.Events.CREATE, () => {
      this.hudReady = true;
      this.mirror = new AccessibilityMirror(this.hud, (repo) => this.select(repo, true));
      this.hud.setSnapshot(this.city);
      this.hud.setConnection(this.connectionState);
      if (this.reducedMotion) this.hud.toast("Reduced motion is on: crews and traffic hold still.");
      const restore = this.registry.get("restore") as { scrollX: number; scrollY: number; zoom: number; selected?: string } | undefined;
      if (restore) {
        this.registry.remove("restore");
        this.cameras.main.setZoom(restore.zoom);
        this.cameras.main.setScroll(restore.scrollX, restore.scrollY);
        if (restore.selected) this.select(restore.selected, false);
        this.hud.toast("Graphics context restored.");
      }
    });

    this.connection = new CityConnection({
      snapshot: (value) => this.snapshot(value),
      mutation: (value) => this.mutation(value),
      status: (freshness) => {
        this.city = { ...this.city, freshness };
        if (this.hudReady) this.hud.setFreshness(freshness);
      },
      connection: (state, detail) => {
        this.connectionState = state;
        if (this.hudReady) this.hud.setConnection(state, detail);
      },
    });
    this.snapshot(this.city);
    this.home();
    this.bindInput();
    this.bindSearch();
    this.connection.connect();
    const onLost = () => this.registry.set("restore", { scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY, zoom: this.cameras.main.zoom, selected: this.selected });
    const onRestored = () => {
      // Generated textures (terrain, people, vehicles) do not survive a context loss.
      this.scene.stop(SceneKeys.Hud);
      this.scene.start(SceneKeys.Preloader);
    };
    const renderer = this.game.renderer as unknown as Phaser.Events.EventEmitter;
    renderer.on("losewebgl", onLost);
    renderer.on("restorewebgl", onRestored);
    this.events.once("shutdown", () => {
      renderer.off("losewebgl", onLost);
      renderer.off("restorewebgl", onRestored);
      // The restarted scene publishes a fresh handle; a stale one must not answer.
      const w = window as unknown as { __AXP?: unknown };
      if ((w.__AXP as { scene?: unknown } | undefined)?.scene === this) delete w.__AXP;
      this.connection.close();
      this.mirror?.destroy();
      this.actors.destroy();
      this.terrain.destroy();
      for (const [name] of this.lots) this.dropLot(name);
      this.images.destroy();
      this.shapes.destroy();
      this.tweens.killAll();
    });
    this.exposeDiagnostics();
  }

  private exposeDiagnostics(): void {
    (window as unknown as { __AXP: unknown }).__AXP = {
      game: this.game,
      scene: this,
      diagnostics: () => ({
        version: Phaser.VERSION,
        renderer: this.game.renderer.type,
        rendererName: this.game.renderer.type === Phaser.WEBGL ? "webgl" : "canvas",
        revision: this.city.revision,
        totalLots: this.city.plan.placements.length,
        visibleLots: this.lots.size,
        chunks: this.terrain.visible,
        cachedChunks: this.terrain.cached,
        generatedChunks: this.terrain.generated,
        objects: this.children.length,
        activeObjects: this.children.length - this.images.parked - this.shapes.parked - this.actors.parked,
        pooledImages: this.images.parked,
        actors: this.actors.count,
        drawnActors: this.actors.drawn,
        assetsInflight: this.assets.inflight,
        zoom: this.cameras.main.zoom,
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
        selected: this.selected,
        following: this.followActor,
        mode: this.city.mode,
        connection: this.connectionState,
        freshness: this.city.freshness,
        reducedMotion: this.reducedMotion,
        censusOpen: this.hudReady && this.hud.censusIsOpen,
        cardVisible: this.hudReady && this.hud.cardVisible,
        office: this.city.plan.civics?.find((c) => c.kind === "office") ?? null,
        civicCount: this.city.plan.civics?.length ?? 0,
        uniqueFacades: new Set(
          this.city.plan.placements.map((p) => `${p.lot.buildingId}:${p.lot.facadeTint}:${p.lot.dressingProp}`),
        ).size,
        frameMs: this.frameStats(),
      }),
      snapshot: () => this.city,
      actorTimeline: (id: string) => this.actors.timeline(id),
      actor: (id: string) => ({ ...this.actors.describe(id), ...this.actors.position(id) }),
      lotActors: (repo: string) => {
        const view = this.lots.get(repo);
        if (!view) return [];
        return planLot(view.place, true, this.now()).anims.map((a) => ({ id: a.actorId, anim: a.anim, behaviour: a.behaviour, drawn: Boolean(this.actors.position(a.actorId)) }));
      },
      ambient: () => this.actors.ambientSnapshot(),
      construction: (repo: string) => {
        const view = this.lots.get(repo);
        return view ? planLot(view.place, true, this.now()).construction ?? null : null;
      },
      select: (repo: string | undefined) => this.select(repo, true),
      setReducedMotion: (on: boolean) => this.setReducedMotion(on),
      resetFrameStats: () => {
        this.frameTimes = [];
      },
      driver: () => this.describeDriver(),
      capture: () => this.capture(),
      screenPoint: (repo: string) => {
        const p = this.city.plan.placements.find((p) => p.lot.fullName === repo);
        if (!p) return null;
        const b = lotBounds(p);
        const view = this.view();
        return { x: (b.x + b.width / 2 - view.x) * this.cameras.main.zoom, y: (b.y + b.height * 0.6 - view.y) * this.cameras.main.zoom };
      },
      screenRect: (repo: string) => this.screenRect(repo),
      pixels: (x: number, y: number, width: number, height: number, grid?: number) => samplePixels(this.game, x, y, width, height, grid),
      lotPixels: (repo: string, grid?: number) => {
        const rect = this.screenRect(repo);
        if (!rect) return Promise.reject(new Error(`${repo} is not in the city`));
        return samplePixels(this.game, rect.x, rect.y, rect.width, rect.height, grid);
      },
      hudPoint: (name: string) => {
        if (!this.hudReady) return null;
        return this.hud.locate(name);
      },
    };
  }

  /** Screen-space rectangle (CSS pixels) covering a lot's building and yard. */
  private screenRect(repo: string): { x: number; y: number; width: number; height: number } | null {
    const p = this.city.plan.placements.find((p) => p.lot.fullName === repo);
    if (!p) return null;
    // Union of the building sprite box and the projected lot diamond (yard included).
    const b = lotBounds(p);
    const corners = [
      project(p.x, p.y),
      project(p.x + LOT_W, p.y),
      project(p.x, p.y + LOT_D),
      project(p.x + LOT_W, p.y + LOT_D),
    ];
    const xs = [b.x, b.x + b.width, ...corners.map((c) => c.sx)];
    const ys = [b.y, b.y + b.height, ...corners.map((c) => c.sy)];
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const view = this.view();
    const zoom = this.cameras.main.zoom;
    return {
      x: (left - view.x) * zoom,
      y: (top - view.y) * zoom,
      width: (Math.max(...xs) - left) * zoom,
      height: (Math.max(...ys) - top) * zoom,
    };
  }

  /** Actual GL driver so performance reports can tell software rendering from a GPU. */
  private describeDriver(): { renderer: string; vendor: string; software: boolean; api: string } {
    const gl = (this.game.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
    if (!gl) return { renderer: "Canvas 2D", vendor: "browser", software: true, api: "canvas" };
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const vendor = String(info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    const software = /swiftshader|llvmpipe|softpipe|software|mesa offscreen/i.test(renderer);
    return { renderer, vendor, software, api: gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl" };
  }

  private frameStats(): { median: number; p95: number; samples: number } {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    if (!sorted.length) return { median: 0, p95: 0, samples: 0 };
    return { median: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], samples: sorted.length };
  }

  private now(): number {
    return Date.now() + this.clockOffset;
  }

  // ---- Data --------------------------------------------------------------
  private geometryKey(city: CitySnapshot): string {
    return JSON.stringify([city.plan.bounds, city.plan.slotBounds, city.plan.features, city.plan.civics]);
  }

  private snapshot(value: CitySnapshot): void {
    const geometryChanged = !this.civics.length || this.geometryKey(value) !== this.geometryKey(this.city);
    const previous = new Set(this.city.plan.placements.map((p) => p.lot.fullName));
    this.city = value;
    this.clockOffset = Date.parse(value.serverTime) - Date.now();
    for (const name of previous) if (!value.plan.placements.some((p) => p.lot.fullName === name)) this.dropLot(name, true);
    if (geometryChanged) this.resetGround();
    if (this.hudReady) this.hud.setSnapshot(value);
    this.lastRefresh = -Infinity;
  }

  private mutation(value: CityMutation): void {
    if (value.revision <= this.city.revision) return;
    if (value.revision !== this.city.revision + 1) {
      this.connection.resync();
      return;
    }
    this.clockOffset = Date.parse(value.serverTime) - Date.now();
    const places = [...this.city.plan.placements];
    let geometry: Partial<CitySnapshot["plan"]> = {};
    let toast: string | undefined;
    switch (value.type) {
      case "lot_added": {
        places.push(value.placement);
        geometry = value.geometry;
        toast = `${value.placement.lot.fullName} is building a home in ${value.placement.district}.`;
        break;
      }
      case "lot_updated": {
        const i = places.findIndex((p) => p.lot.fullName === value.placement.lot.fullName);
        if (i < 0) places.push(value.placement);
        else places[i] = value.placement;
        break;
      }
      case "lot_renamed": {
        const i = places.findIndex((p) => p.lot.fullName === value.previousFullName);
        if (i >= 0) places[i] = value.placement;
        else places.push(value.placement);
        this.dropLot(value.previousFullName, true);
        if (this.selected === value.previousFullName) this.selected = value.placement.lot.fullName;
        toast = `${value.previousFullName} is now ${value.placement.lot.fullName}; same address.`;
        break;
      }
      case "lot_removed": {
        const i = places.findIndex((p) => p.lot.fullName === value.fullName);
        if (i >= 0) places.splice(i, 1);
        geometry = value.geometry;
        this.dropLot(value.fullName, true);
        if (this.selected === value.fullName) this.select(undefined, false);
        toast = `${value.fullName} left the city (${value.reason}). Its neighbours stay put.`;
        break;
      }
    }
    const next: CitySnapshot = {
      ...this.city,
      revision: value.revision,
      serverTime: value.serverTime,
      plan: { ...this.city.plan, ...geometry, placements: places },
    };
    const geometryChanged = Object.keys(geometry).length > 0 && this.geometryKey(next) !== this.geometryKey(this.city);
    this.city = next;
    if (geometryChanged) this.resetGround();
    if (this.hudReady) {
      this.hud.setSnapshot(this.city);
      if (toast) this.hud.toast(toast);
    }
    this.lastRefresh = -Infinity;
  }

  private resetGround(): void {
    this.terrain.invalidate();
    for (const object of this.civics) object.destroy();
    this.civics = drawCivics(this, this.city.plan);
    this.actors.setAmbient(ambientActors(this.city.plan));
  }

  // ---- Lots --------------------------------------------------------------
  private dropLot(name: string, forget = false): void {
    const view = this.lots.get(name);
    if (view) {
      for (const image of view.images) this.images.release(image);
      for (const g of view.shapes) this.shapes.release(g);
      this.lots.delete(name);
    }
    if (forget) this.actors.removeLot(name);
  }

  private signature(place: LotPlacement, ops: LotRenderPlan): string {
    // fetchedAt and freshness bookkeeping are deliberately excluded: a
    // freshness-only refresh must not rebuild the lot.
    const { fetchedAt: _f, partial: _p, ...lot } = place.lot;
    const c = ops.construction;
    return JSON.stringify([lot, place.x, place.y, c ? [c.stage, Math.round(c.scaffold * 24), Math.round(c.buildingAlpha * 24)] : null]);
  }

  private buildLot(place: LotPlacement, previous?: LotView): void {
    const now = this.now();
    const ops = planLot(place, true, now);
    const signature = this.signature(place, ops);
    if (previous?.signature === signature) return;
    if (previous) this.dropLot(place.lot.fullName);
    const images: Phaser.GameObjects.Image[] = [];
    let incomplete = false;
    const shapes: Phaser.GameObjects.Graphics[] = [];
    const bounds = lotBounds(place);
    if (ops.diamonds.length || ops.ellipses.length) {
      const g = this.shapes.acquire();
      g.setDepth(-99_980);
      for (const op of ops.diamonds) drawDiamond(g, op);
      for (const op of ops.ellipses) stampEllipse(g, op);
      shapes.push(g);
    }
    for (const op of ops.images) {
      if (!this.assets.ready(op.sheet, op.url)) {
        if (!this.assets.isFailed(op.sheet)) incomplete = true;
        continue;
      }
      const image = this.images.acquire();
      image.setTexture(op.sheet, ensureFrame(this, op.sheet, op.box));
      image.setPosition(op.sx, op.sy).setOrigin(0.5, 1).setScale(op.scaleX, op.scaleY);
      image.setDepth(op.layer === "ground" ? -99_999 : op.depth);
      image.setAlpha(op.alpha ?? (op.dimmed ? 0.62 : 1));
      if (op.tint && op.tint !== 0xffffff) image.setTint(op.tint);
      else image.clearTint();
      image.setData("repo", place.lot.fullName);
      images.push(image);
    }
    if (
      ops.construction &&
      ops.construction.scaffold > 0 &&
      !ops.images.some((image) => image.tag === "scaffold-art")
    ) {
      const site = ops.construction;
      const scaffold = this.shapes.acquire();
      const size = buildingSize(place.lot);
      const anchor = project(place.x + 1, place.y + LOT_D / 2);
      const height = (size.height * 0.85) * site.scaffold;
      const width = size.width * 0.7;
      scaffold.setDepth(anchor.sy + 3);
      scaffold.lineStyle(2.5, 0xc4a574, 0.95);
      for (const px of [-width / 2, width / 2]) scaffold.lineBetween(anchor.sx + px, anchor.sy, anchor.sx + px, anchor.sy - height);
      scaffold.lineStyle(1.5, 0xd7b07a, 0.9);
      for (let y = anchor.sy - 16; y > anchor.sy - height; y -= 18) {
        scaffold.lineBetween(anchor.sx - width / 2, y, anchor.sx + width / 2, y);
        scaffold.lineBetween(anchor.sx - width / 2, y, anchor.sx + width / 2, y + 16);
      }
      scaffold.fillStyle(0xb8894c, 1).fillRect(anchor.sx - width / 2 - 4, anchor.sy - height - 4, width + 8, 5);
      shapes.push(scaffold);
    }
    this.actors.setLotActors(place.lot.fullName, ops.anims);
    for (const anim of ops.anims) if (!this.assets.ready(anim.anim)) incomplete = true;
    this.lots.set(place.lot.fullName, { images, shapes, signature, bounds, place, incomplete });
    if (this.selected === place.lot.fullName && this.hudReady) this.hud.setSelection(place);
  }

  private view(): Rect {
    const c = this.cameras.main;
    return { x: c.scrollX + c.width / 2 - c.width / (2 * c.zoom), y: c.scrollY + c.height / 2 - c.height / (2 * c.zoom), width: c.width / c.zoom, height: c.height / c.zoom };
  }

  private refresh(): void {
    const view = this.view();
    this.terrain.sync(visibleChunks(view), this.city.plan);
    const padded = { x: view.x - 220, y: view.y - 260, width: view.width + 440, height: view.height + 480 };
    const wanted = new Set<string>();
    for (const place of this.city.plan.placements) {
      const bounds = lotBounds(place);
      const anchor = project(place.x + 2, place.y + 1);
      if (!overlaps(padded, { x: Math.min(bounds.x, anchor.sx - 150), y: bounds.y - 60, width: Math.max(bounds.width, 300), height: bounds.height + 170 })) continue;
      const name = place.lot.fullName;
      wanted.add(name);
      const previous = this.lots.get(name);
      if (previous && previous.place !== place) previous.signature = "";
      if (previous && previous.signature && !previous.place.addedAt && !previous.incomplete) continue;
      this.buildLot(place, previous);
    }
    for (const [name] of this.lots) if (!wanted.has(name)) this.dropLot(name);
    this.actors.sync(view);
    this.drawSelection();
    const center = unproject(view.x + view.width / 2, view.y + view.height / 2);
    const b = this.city.plan.bounds;
    const developed = center.x >= b.minX && center.x <= b.maxX && center.y >= b.minY && center.y <= b.maxY;
    if (this.hudReady)
      this.hud.setCamera(view, this.cameras.main.zoom, developed ? districtName(Math.floor(center.x / STRIDE_X), Math.floor(center.y / STRIDE_Y)) : "The Wilds", center.x, center.y);
  }

  private drawSelection(): void {
    this.highlight.clear();
    const p = this.city.plan.placements.find((p) => p.lot.fullName === this.selected);
    if (!p) return;
    const points = [project(p.x, p.y), project(p.x + LOT_W, p.y), project(p.x + LOT_W, p.y + LOT_D), project(p.x, p.y + LOT_D)].map((q) => new Phaser.Math.Vector2(q.sx, q.sy));
    this.highlight.lineStyle(2, 0xf6dd91, 0.9).strokePoints(points, true);
    if (this.followActor) {
      const at = this.actors.position(this.followActor);
      if (at) this.highlight.lineStyle(1.5, 0xf6dd91, 0.8).strokeCircle(at.sx, at.sy - 10, 16);
    }
  }

  // ---- Selection, following, camera -------------------------------------
  /** The single selection path: scene highlight, follow state, HUD card, MASS bar and mirror all follow it. */
  /** Returns false when `repo` names nothing in the city. */
  select(repo: string | undefined, frame: boolean): boolean {
    const place = repo ? findPlacement(this.city.plan, repo) : undefined;
    if (repo && !place) {
      if (this.hudReady) this.hud.toast(`No repository matches “${repo}”.`);
      return false;
    }
    this.stopFollowing();
    this.selected = place?.lot.fullName;
    if (this.hudReady) this.hud.setSelection(place);
    this.drawSelection();
    if (place && frame) this.frameLot(place);
    return true;
  }

  private toggleFollow(): void {
    if (this.followActor) {
      this.stopFollowing();
      if (this.hudReady) this.hud.toast("Free camera.");
      return;
    }
    if (!this.selected) {
      if (this.hudReady) this.hud.toast("Select a repository first, then press F to follow its crew.");
      return;
    }
    const view = this.lots.get(this.selected);
    if (!view) this.frameLot(this.city.plan.placements.find((p) => p.lot.fullName === this.selected)!);
    const id = this.actors.primaryActor(this.selected);
    if (!id) {
      if (this.hudReady) this.hud.toast("This lot has no moving crew to follow right now.");
      return;
    }
    this.followActor = id;
    const who = this.actors.describe(id);
    if (this.hudReady) this.hud.toast(`Following ${who?.behaviour === "fly" ? "the delivery drone" : who?.behaviour === "carry" ? "a carrier" : "a crew member"} on ${this.selected}. Press F or drag to stop.`);
  }

  /** Any direct camera input takes over from following and from a running pan. */
  private stopFollowing(): void {
    this.followActor = undefined;
    const pan = this.cameras.main.panEffect;
    if (pan.isRunning) pan.reset();
  }

  private home(): void {
    this.stopFollowing();
    const center = project(3.5, 2);
    this.cameras.main.setZoom(innerWidth < 700 ? 0.9 : 1);
    this.cameras.main.centerOn(center.sx, center.sy);
    this.lastRefresh = -Infinity;
  }

  private frameLot(place: LotPlacement): void {
    const camera = this.cameras.main,
      bounds = lotBounds(place);
    const small = camera.width < 700;
    const targetX = small ? camera.width / 2 : (camera.width - 340) / 2;
    const cardTop = this.hudReady ? this.hud.cardBottom : camera.height;
    const targetY = small ? Math.max(170, (140 + cardTop) / 2) : camera.height / 2;
    const x = bounds.x + bounds.width / 2 + (camera.width / 2 - targetX) / camera.zoom;
    const y = bounds.y + bounds.height * 0.55 + (camera.height / 2 - targetY) / camera.zoom;
    if (this.reducedMotion) camera.centerOn(x, y);
    else camera.pan(x, y, 350, "Cubic.easeInOut");
  }

  private hit(x: number, y: number): LotPlacement | undefined {
    const ordered = [...this.lots.values()].sort((a, b) => b.place.x + b.place.y - (a.place.x + a.place.y));
    return ordered.find(
      ({ place, bounds }) =>
        (x >= bounds.x - 8 && x <= bounds.x + bounds.width + 8 && y >= bounds.y - 5 && y <= bounds.y + bounds.height + 8) ||
        diamondContains(place.x, place.y, LOT_W, LOT_D, x, y),
    )?.place;
  }

  private zoomAt(factor: number, x = this.cameras.main.width / 2, y = this.cameras.main.height / 2): void {
    const c = this.cameras.main,
      zoom = Phaser.Math.Clamp(c.zoom * factor, 0.35, 2.2);
    const wx = c.scrollX + c.width / 2 + (x - c.width / 2) / c.zoom,
      wy = c.scrollY + c.height / 2 + (y - c.height / 2) / c.zoom;
    c.setZoom(zoom);
    c.scrollX = wx - c.width / 2 - (x - c.width / 2) / zoom;
    c.scrollY = wy - c.height / 2 - (y - c.height / 2) / zoom;
    if (this.hudReady) this.hud.hideTag();
    this.lastRefresh = -Infinity;
  }

  setReducedMotion(on: boolean): boolean {
    this.reducedMotion = on;
    this.actors.reducedMotion = on;
    this.registry.set("reducedMotion", on);
    return !on;
  }

  private capture(): void {
    downloadCapture(this.game, `axp-city-r${this.city.revision}.png`, () => this.hudReady && this.hud.toast("Saved a PNG of the current view."));
  }

  // ---- Input -------------------------------------------------------------
  private bindSearch(): void {
    const input = document.querySelector<HTMLInputElement>("#repo-search");
    if (!input) return;
    input.oninput = () => {
      if (this.hudReady) this.hud.setCensusFilter(input.value);
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        const found = this.select(input.value, true);
        // A successful jump consumes the query so the census is not left filtered.
        if (found) {
          input.value = "";
          if (this.hudReady) this.hud.setCensusFilter("");
        }
        input.blur();
      } else if (event.key === "Escape") {
        input.value = "";
        if (this.hudReady) this.hud.setCensusFilter("");
        input.blur();
      }
    };
  }

  private bindInput(): void {
    this.input.addPointer(2);
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.hudReady && this.hud.consumes(p.x, p.y)) return;
      this.stopFollowing();
      this.drag = { id: p.id, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: false };
      if (this.hudReady) this.hud.hideTag();
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const down = this.input.manager.pointers.filter((q) => q.isDown);
      if (down.length >= 2) {
        const [a, b] = down,
          distance = Math.hypot(a.x - b.x, a.y - b.y),
          x = (a.x + b.x) / 2,
          y = (a.y + b.y) / 2;
        if (this.pinch) {
          this.zoomAt(distance / this.pinch.distance, x, y);
          this.cameras.main.scrollX -= (x - this.pinch.x) / this.cameras.main.zoom;
          this.cameras.main.scrollY -= (y - this.pinch.y) / this.cameras.main.zoom;
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
      if (!this.hudReady) return;
      if (this.hud.consumes(p.x, p.y)) {
        this.hud.hideTag();
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
      if (hit) this.select(hit.lot.fullName, this.cameras.main.width < 700);
      else this.select(undefined, false);
    });
    this.input.on("pointerupoutside", () => {
      this.drag = undefined;
      this.pinch = undefined;
    });
    this.input.on("wheel", (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (this.hudReady && this.hud.censusIsOpen && this.hud.consumes(p.x, p.y)) return;
      this.zoomAt(Math.exp(-dy * 0.0015), p.x, p.y);
    });
    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT") as typeof this.keys;
      kb.on("keydown", (event: KeyboardEvent) => {
        if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLButtonElement) return;
        const key = event.key;
        if (/^[0-9]$/.test(key)) {
          const p = this.city.plan.placements[(Number(key) + 9) % 10];
          if (p) this.select(p.lot.fullName, true);
        } else if (key === "/" ) {
          event.preventDefault();
          document.querySelector<HTMLInputElement>("#repo-search")?.focus();
        } else if (key.toLowerCase() === "f") this.toggleFollow();
        else if (key.toLowerCase() === "c" && this.hudReady) this.hud.toggleCensus();
        else if (key.toLowerCase() === "h") this.home();
        else if (key.toLowerCase() === "m") this.setReducedMotion(!this.reducedMotion);
        else if (key === "+" || key === "=") this.zoomAt(1.2);
        else if (key === "-" || key === "_") this.zoomAt(1 / 1.2);
        else if (key === "Escape") {
          if (this.hudReady && this.hud.censusIsOpen) this.hud.toggleCensus(false);
          else this.select(undefined, false);
        } else if (this.hudReady && this.hud.censusIsOpen && (key === "ArrowDown" || key === "ArrowUp" || key === "Enter")) {
          event.preventDefault();
          if (key === "Enter") {
            if (this.selected) this.frameLot(this.city.plan.placements.find((p) => p.lot.fullName === this.selected)!);
          } else {
            const row = this.hud.censusStep(key === "ArrowDown" ? 1 : -1);
            if (row) this.select(row.repo, false);
          }
        }
      });
    }
    const double = () => this.home();
    this.game.canvas.addEventListener("dblclick", double);
    this.events.once("shutdown", () => this.game.canvas.removeEventListener("dblclick", double));
  }

  private air(time: number): void {
    const g = this.atmosphere,
      c = this.cameras.main,
      w = c.width,
      h = c.height,
      t = this.reducedMotion ? 0 : time / 1000;
    g.clear();
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
    if (this.weather) {
      for (let i = 0; i < 4; i++) {
        const x = ((t * 5 + (i * w) / 3) % (w + 500)) - 250,
          y = h * (0.15 + i * 0.18);
        g.fillStyle(0xf5f5e9, 0.13);
        g.fillEllipse(x, y, 360, 100);
        g.fillEllipse(x + 70, y - 15, 210, 70);
      }
    }
  }

  update(time: number, delta: number): void {
    const c = this.cameras.main;
    const inputTime = performance.now();
    const elapsed = Math.min(inputTime - this.lastInputTime, 500);
    this.lastInputTime = inputTime;
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    const typing = document.activeElement instanceof HTMLInputElement;
    if (!typing && !(this.hudReady && this.hud.censusIsOpen)) {
      const x = this.move.x + (this.keys.D?.isDown || this.keys.RIGHT?.isDown ? 1 : 0) - (this.keys.A?.isDown || this.keys.LEFT?.isDown ? 1 : 0);
      const y = this.move.y + (this.keys.S?.isDown || this.keys.DOWN?.isDown ? 1 : 0) - (this.keys.W?.isDown || this.keys.UP?.isDown ? 1 : 0);
      if (x || y) {
        this.stopFollowing();
        c.scrollX += (((x * 420) / c.zoom) * elapsed) / 1000;
        c.scrollY += (((y * 420) / c.zoom) * elapsed) / 1000;
      }
    }
    this.actors.step(Math.min(delta, 100));
    if (this.followActor) {
      const at = this.actors.position(this.followActor);
      if (at) {
        const k = this.reducedMotion ? 1 : Math.min(1, elapsed / 180);
        c.scrollX += (at.sx - c.width / 2 - c.scrollX) * k;
        c.scrollY += (at.sy - 20 - c.height / 2 - c.scrollY) * k;
      } else this.followActor = undefined;
    }
    const cameraKey = `${Math.round(c.scrollX)}:${Math.round(c.scrollY)}:${c.zoom.toFixed(3)}:${c.width}x${c.height}`;
    if (time - this.lastRefresh > 100 || cameraKey !== this.lastCamera) {
      this.refresh();
      this.lastRefresh = time;
      this.lastCamera = cameraKey;
    } else this.actors.update();
    if (this.followActor) this.drawSelection();
    this.air(time);
  }
}
