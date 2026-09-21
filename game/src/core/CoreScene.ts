import Phaser from "phaser";
import {
  createWorld,
  cellAt,
  roadMask,
  waterMask,
  previewCommand,
  applyCommand,
  advanceWorld,
  serializeWorld,
  deserializeWorld,
  vehiclePose,
  BUILDINGS,
  type WorldState,
  type Tool,
  type BuildingKind,
} from "../../../src/core/index.js";
import {
  TILE_W,
  TILE_H,
  coreProject,
  coreUnproject,
  drawTerrain,
  createCoreTextures,
  buildingSpriteSpec,
  treeSpriteSpec,
  vehicleSpriteSpec,
} from "./art.js";
import { imagePool, type ObjectPool } from "../pool.js";

const SAVE_KEY = "axp-core-world-v1";
const CHUNK = 8;
const CAMERA_KEYS = "W,A,S,D,UP,DOWN,LEFT,RIGHT";
const TOOLS: Tool[] = [
  "inspect",
  "road",
  "cottage",
  "shop",
  "workshop",
  "bulldoze",
];
const TITLES: Record<Tool, string> = {
  inspect: "Explore your town",
  road: "Connect the neighborhood",
  cottage: "A place to call home",
  shop: "Open a neighborhood shop",
  workshop: "Make room for makers",
  bulldoze: "Clear a little space",
};
const HINTS: Record<Tool, string> = {
  inspect: "Select a building for details. Drag to explore.",
  road: "Click dry, empty ground to lay a road.",
  cottage: "A 2 × 2 home. Face the front door toward a road.",
  shop: "A 3 × 2 shop. Keep a road along its front edge.",
  workshop: "A 3 × 3 workshop. Leave road access at the front.",
  bulldoze: "Click a building or road to remove it.",
};
interface Chunk {
  image: Phaser.GameObjects.Image;
  texture: string;
}
interface CameraState {
  x: number;
  y: number;
  zoom: number;
}
export interface RepositoryBuilding {
  fullName: string;
  url: string;
  language: string | null;
  topics: string[] | null;
}
interface LocalTown {
  world: WorldState;
  camera: CameraState;
  paused: boolean;
  tool: Tool;
  dirty: boolean;
  undo: string[];
  selectedBuildingId?: string;
}

export class CoreScene extends Phaser.Scene {
  /** Host navigation hook. Called when a city zoom-out would pass minimum zoom. */
  onAtlasRequested?: () => void;
  private world!: WorldState;
  private tool: Tool = "inspect";
  private paused = false;
  private chunks = new Map<string, Chunk>();
  private scenery = new Map<string, Phaser.GameObjects.Image>();
  private cars = new Map<string, Phaser.GameObjects.Image>();
  private pool!: ObjectPool<Phaser.GameObjects.Image>;
  private ghost!: Phaser.GameObjects.Graphics;
  private selection!: Phaser.GameObjects.Graphics;
  private selectionFootprint!: Phaser.GameObjects.Graphics;
  private hovered?: { x: number; y: number };
  private selectedBuildingId?: string;
  private buildingBoundsCache = new Map<string, Phaser.Geom.Rectangle>();
  private drag?: {
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    id: number;
  };
  private pinch?: { distance: number; zoom: number };
  private undo: string[] = [];
  private cleanup: (() => void)[] = [];
  private lastTime = 0;
  private lastStats = 0;
  private cameraKey = "";
  private dirty = false;
  private generation = 0;
  private frameTimes: number[] = [];
  private atlasActive = false;
  private atlasCamera?: CameraState;
  private ready = false;
  private regionReadOnly = false;
  private repositoryBuildings: Record<string, RepositoryBuilding> = {};
  private localTown?: LocalTown;
  private status?: { text: string; error: boolean };

  constructor() {
    super("CoreCity");
  }

  create(data?: {
    world?: WorldState;
    camera?: CameraState;
    paused?: boolean;
    selectedBuildingId?: string;
    atlasActive?: boolean;
  }): void {
    this.ready = false;
    this.atlasActive = data?.atlasActive ?? this.atlasActive;
    this.generation++;
    this.cleanup = [];
    this.chunks = new Map();
    this.scenery = new Map();
    this.cars = new Map();
    this.drag = undefined;
    this.pinch = undefined;
    this.selectedBuildingId = undefined;
    this.buildingBoundsCache.clear();
    this.cameraKey = "";
    this.world = data?.world ?? createWorld();
    this.paused = data?.paused ?? false;
    let restoreWarning: string | undefined;
    if (!data?.world) {
      try {
        const saved = localStorage.getItem(SAVE_KEY);
        if (saved) this.world = deserializeWorld(saved);
      } catch {
        restoreWarning =
          "Your saved town could not be read. A fresh town is open; the saved copy has been kept.";
      }
    }
    createCoreTextures(this);
    this.pool = imagePool(this, 800);
    this.ghost = this.add.graphics().setDepth(900000);
    this.selection = this.add.graphics().setDepth(899999);
    this.selectionFootprint = this.add.graphics().setDepth(-99999);
    this.game.canvas.tabIndex = 0;
    this.game.canvas.setAttribute("aria-label", "Town map");
    const missingPointers = 3 - this.input.manager.pointers.length;
    if (missingPointers > 0) this.input.addPointer(missingPointers);
    this.input.mouse?.disableContextMenu();
    this.rebuildTerrain();
    this.rebuildScenery();
    this.bindUI();
    this.bindInput();
    this.homeCamera();
    if (data?.camera) {
      this.cameras.main
        .setZoom(data.camera.zoom)
        .setScroll(data.camera.x, data.camera.y);
    }
    this.syncVisible();
    this.updateCars();
    this.updateStats();
    this.renderTool();
    if (data?.selectedBuildingId && this.tool === "inspect")
      this.selectBuilding(data.selectedBuildingId);
    else if (!this.status) this.message(HINTS[this.tool]);
    if (restoreWarning) this.message(restoreWarning, true);
    document.getElementById("boot-card")!.hidden = true;
    this.lastTime = performance.now();
    const visibility = () => {
      this.lastTime = performance.now();
    };
    document.addEventListener("visibilitychange", visibility);
    this.cleanup.push(() =>
      document.removeEventListener("visibilitychange", visibility),
    );
    const renderer = this.game
      .renderer as unknown as Phaser.Events.EventEmitter;
    const restored = () => {
      const camera = this.cameras.main;
      this.scene.restart({
        world: this.world,
        paused: this.paused,
        selectedBuildingId: this.selectedBuildingId,
        atlasActive: this.atlasActive,
        camera: this.atlasCamera ?? {
          x: camera.scrollX,
          y: camera.scrollY,
          zoom: camera.zoom,
        },
      });
    };
    renderer.on("restorewebgl", restored);
    this.cleanup.push(() => renderer.off("restorewebgl", restored));
    this.events.once("shutdown", () => {
      this.ready = false;
      for (const fn of this.cleanup) fn();
      for (const chunk of this.chunks.values()) {
        chunk.image.destroy();
        this.textures.remove(chunk.texture);
      }
      for (const sprite of [...this.scenery.values(), ...this.cars.values()])
        if (sprite.scene) this.pool.release(sprite);
      this.pool.destroy();
      delete (window as unknown as { __CORE?: unknown }).__CORE;
    });
    (window as unknown as { __CORE: unknown }).__CORE = {
      snapshot: () => JSON.parse(serializeWorld(this.world)),
      diagnostics: () => ({
        tick: this.world.tick,
        revision: this.world.revision,
        buildings: this.world.buildings.length,
        vehicles: this.world.vehicles.length,
        zoom: this.cameras.main.zoom,
        paused: this.paused,
        atlasActive: this.atlasActive,
        repositoryDistrict: this.regionReadOnly,
        selectedTool: this.tool,
        selectedBuildingId: this.selectedBuildingId ?? null,
        renderer: this.game.renderer.type === Phaser.WEBGL ? "webgl" : "canvas",
        chunks: this.chunks.size,
        visibleChunks: [...this.chunks.values()].filter((c) => c.image.visible)
          .length,
        objects: this.children.length,
        textures: Object.keys(this.textures.list).length,
        generation: this.generation,
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
        frameTimes: [...this.frameTimes],
      }),
      cellScreen: (x: number, y: number) => this.cellScreen(x, y),
      buildingScreen: (id: string) => {
        const bounds = this.scenery.get(id)?.getBounds();
        return bounds
          ? this.worldScreen(
              bounds.x + bounds.width * 0.5,
              bounds.y + bounds.height * 0.42,
            )
          : null;
      },
      home: () => this.home(),
      inspectCell: (x: number, y: number) => cellAt(this.world, x, y),
      placementPreview: () => ({
        cell: this.hovered ?? null,
        commandCount: this.ghost.commandBuffer.length,
      }),
      selection: () => ({
        buildingId: this.selectedBuildingId ?? null,
        commandCount:
          this.selection.commandBuffer.length +
          this.selectionFootprint.commandBuffer.length,
      }),
      vehiclePoses: () =>
        this.world.vehicles.map((v) => ({
          id: v.id,
          ...vehiclePose(this.world, v),
        })),
    };
    this.ready = true;
    this.setAtlasActive(this.atlasActive);
  }

  /**
   * Give the atlas ownership of the view without sleeping this scene. The host
   * hides/inerts city DOM controls and retains the game element's dimensions;
   * this bridge suspends city input/render work
   * while the current world's fixed-step simulation continues. Returning keeps
   * the camera and selected building. The flag survives graphics recovery.
   */
  setAtlasActive(active: boolean): void {
    const previous = this.atlasActive;
    this.atlasActive = active;
    if (!this.ready) return;
    this.cancelGesture();
    const keyboard = this.input.keyboard;
    keyboard?.resetKeys();
    for (const pointer of this.input.manager.pointers) pointer.reset();
    this.input.enabled = !active;
    this.game.canvas.tabIndex = active ? -1 : 0;
    this.game.canvas.setAttribute("aria-hidden", String(active));
    if (keyboard) {
      keyboard.enabled = !active;
      if (active) keyboard.removeCapture(CAMERA_KEYS);
      else keyboard.addCapture(CAMERA_KEYS);
    }
    this.cameras.main.setVisible(!active);
    if (active) {
      if (!previous || !this.atlasCamera) this.atlasCamera = this.cameraState();
      return;
    }
    if (this.atlasCamera) this.restoreCamera(this.atlasCamera);
    this.atlasCamera = undefined;
    this.cameraKey = "";
    this.syncVisible();
    this.updateCars();
    this.renderTool();
    if (this.selectedBuildingId) this.selectBuilding(this.selectedBuildingId);
    else this.clearSelection();
    if (this.status) this.message(this.status.text, this.status.error);
    this.updateStats();
  }

  /** After scene creation, open a validated repository world without touching browser saves or the
   * local town's edit history. Only inspection and camera controls are enabled.
   * Metadata and the local backup survive this scene's context-recovery restart.
   */
  setRepositoryDistrict(
    world: WorldState,
    repoByBuildingId: Record<string, RepositoryBuilding>,
  ): void {
    if (!this.localTown) {
      this.localTown = {
        world: this.world,
        camera: this.atlasCamera ?? this.cameraState(),
        paused: this.paused,
        tool: this.tool,
        dirty: this.dirty,
        undo: this.undo,
        selectedBuildingId: this.selectedBuildingId,
      };
    }
    this.cancelGesture();
    this.world = world;
    this.repositoryBuildings = repoByBuildingId;
    this.regionReadOnly = true;
    this.paused = false;
    this.tool = "inspect";
    this.undo = [];
    this.dirty = false;
    this.rebuildAll();
    this.homeCamera();
    if (this.atlasActive) this.atlasCamera = this.cameraState();
    this.renderTool();
    this.message(
      "Explore this repository district. Select a building for details.",
    );
    this.syncVisible();
    this.updateStats();
  }

  /** Return to the retained local town, including its view and unsaved edits. */
  restoreLocalTown(): void {
    const local = this.localTown;
    if (!local) return;
    this.cancelGesture();
    this.world = local.world;
    this.regionReadOnly = false;
    this.repositoryBuildings = {};
    this.paused = local.paused;
    this.tool = local.tool;
    this.dirty = local.dirty;
    this.undo = local.undo;
    this.localTown = undefined;
    this.rebuildAll();
    this.restoreCamera(local.camera);
    if (this.atlasActive) this.atlasCamera = local.camera;
    this.renderTool();
    this.message(HINTS[this.tool]);
    if (local.selectedBuildingId) this.selectBuilding(local.selectedBuildingId);
    this.syncVisible();
    this.updateStats();
  }

  private cameraState(): CameraState {
    const camera = this.cameras.main;
    return { x: camera.scrollX, y: camera.scrollY, zoom: camera.zoom };
  }

  private restoreCamera(camera: CameraState): void {
    this.cameras.main.setZoom(camera.zoom).setScroll(camera.x, camera.y);
    this.cameraKey = "";
  }

  private message(text: string, error = false): void {
    this.status = { text, error };
    if (this.atlasActive) return;
    const el = document.querySelector<HTMLElement>("[data-testid=status]")!;
    el.textContent = text;
    el.dataset.tone = error ? "error" : "normal";
  }
  private bindUI(): void {
    const on = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn);
      this.cleanup.push(() => target.removeEventListener(type, fn));
    };
    document
      .querySelectorAll<HTMLElement>("[data-tool]")
      .forEach((el) =>
        on(el, "click", () => this.setTool(el.dataset.tool as Tool)),
      );
    document
      .querySelectorAll<HTMLElement>("[data-action]")
      .forEach((el) => on(el, "click", () => this.action(el.dataset.action!)));
    on(window, "keydown", ((event: KeyboardEvent) => {
      if (this.atlasActive) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        event.defaultPrevented ||
        document.querySelector("[popover]:popover-open") ||
        target?.isContentEditable ||
        (event.code === "Space" && target?.closest("button")) ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (
        this.regionReadOnly &&
        (event.code === "Space" ||
          ((event.metaKey || event.ctrlKey) && /^[sz]$/i.test(event.key)))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.action("save");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.action("undo");
        return;
      }
      if (event.repeat) return;
      if (/^[1-6]$/.test(event.key)) this.setTool(TOOLS[Number(event.key) - 1]);
      if (event.key === "Escape") this.setTool("inspect");
      if (event.code === "Space") {
        event.preventDefault();
        this.action("pause");
      }
      if (event.key.toLowerCase() === "h") this.home();
      if (event.key === "+" || event.key === "=") this.zoom(1.18);
      if (event.key === "-") this.zoom(1 / 1.18);
    }) as EventListener);
    this.input.keyboard?.addKeys(CAMERA_KEYS);
  }
  private setTool(tool: Tool): void {
    if (this.atlasActive || (this.regionReadOnly && tool !== "inspect")) return;
    this.clearSelection();
    this.tool = tool;
    this.renderTool();
    this.message(HINTS[tool]);
    this.drawGhost();
  }
  private renderTool(): void {
    if (this.atlasActive) return;
    const tool = this.tool;
    this.ghost.setDepth(tool === "inspect" ? -99998 : 900000);
    document
      .querySelectorAll<HTMLElement>("[data-tool]")
      .forEach((el) =>
        el.setAttribute("aria-pressed", String(el.dataset.tool === tool)),
      );
    document.getElementById("tool-title")!.textContent = this.regionReadOnly
      ? "Explore repositories"
      : TITLES[tool];
    document.getElementById("tool-description")!.textContent = HINTS[tool];
  }
  private action(name: string): void {
    if (this.atlasActive) return;
    if (
      this.regionReadOnly &&
      ![
        "close-selection",
        "focus-selection",
        "home",
        "zoom-in",
        "zoom-out",
      ].includes(name)
    )
      return;
    if (name === "close-selection") {
      this.clearSelection();
      this.game.canvas.focus({ preventScroll: true });
      this.message(HINTS[this.tool]);
    } else if (name === "focus-selection") {
      this.focusSelection();
    } else if (name === "pause") {
      this.paused = !this.paused;
      this.lastTime = performance.now();
      this.updateStats();
    } else if (name === "home") this.home();
    else if (name === "zoom-in") this.zoom(1.18);
    else if (name === "zoom-out") this.zoom(1 / 1.18);
    else if (name === "save") {
      try {
        localStorage.setItem(SAVE_KEY, serializeWorld(this.world));
        this.dirty = false;
        this.message("Town saved in this browser.");
        this.updateStats();
      } catch {
        this.message(
          "This browser could not save the town. Your open town is unchanged.",
          true,
        );
      }
    } else if (name === "load") {
      try {
        const text = localStorage.getItem(SAVE_KEY);
        if (!text) {
          this.message("No saved town yet. Use Save town first.", true);
          return;
        }
        const loaded = deserializeWorld(text);
        this.remember();
        this.world = loaded;
        this.dirty = false;
        this.rebuildAll();
        this.message("Saved town restored.");
      } catch {
        this.message(
          "That saved town is invalid. Your open town is unchanged.",
          true,
        );
      }
    } else if (name === "reset") {
      this.remember();
      this.world = createWorld();
      this.dirty = true;
      this.rebuildAll();
      this.home();
      this.message("A fresh town is open. Undo returns to your previous town.");
    } else if (name === "undo") {
      const previous = this.undo.pop();
      if (previous) {
        this.world = deserializeWorld(previous);
        this.dirty = true;
        this.rebuildAll();
        this.message("Last edit undone.");
      }
    }
  }
  private remember(): void {
    this.undo.push(serializeWorld(this.world));
    if (this.undo.length > 30) this.undo.shift();
  }
  private rebuildAll(): void {
    this.clearSelection();
    this.lastTime = performance.now();
    this.rebuildTerrain();
    this.rebuildScenery();
    this.updateCars();
    this.drawGhost();
    this.updateStats();
    this.syncVisible();
  }

  private clearSelection(): void {
    this.selectedBuildingId = undefined;
    this.selection.clear();
    this.selectionFootprint.clear();
    if (this.atlasActive) return;
    const inspector = document.getElementById("building-inspector")!;
    // A dismissed card must not leave keyboard focus on an invisible button.
    if (inspector.contains(document.activeElement))
      this.game.canvas.focus({ preventScroll: true });
    inspector.hidden = true;
    delete inspector.dataset.buildingId;
  }

  private selectBuilding(id: string): void {
    const building = this.world.buildings.find((b) => b.id === id);
    if (!building) {
      this.clearSelection();
      return;
    }
    this.selectedBuildingId = id;
    if (this.atlasActive) return;
    const spec = BUILDINGS[building.kind];
    const repository = this.repositoryBuildings[id];
    const access = cellAt(
      this.world,
      building.x + spec.access.x,
      building.y + spec.access.y,
    );
    const inspector = document.getElementById("building-inspector")!;
    inspector.dataset.buildingId = id;
    document.getElementById("building-title")!.textContent =
      repository?.fullName ?? spec.name;
    const link = document.querySelector<HTMLAnchorElement>("#building-repo");
    if (link) {
      link.hidden = !repository;
      link.textContent = repository?.fullName ?? "";
      // Repository metadata is external data; never promote an arbitrary URL
      // into a clickable script or unrelated navigation.
      const safe = repository?.url.match(
        /^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/?$/i,
      );
      if (safe) link.href = repository.url;
      else link.removeAttribute("href");
    }
    const topics = document.getElementById("building-topics");
    if (topics) {
      topics.hidden = !repository;
      topics.textContent = repository
        ? [repository.language, ...(repository.topics ?? [])]
            .filter(Boolean)
            .join(" · ")
        : "";
    }
    document.getElementById("building-location")!.textContent =
      `Lot ${building.x}, ${building.y}`;
    document.getElementById("building-footprint")!.textContent =
      `${spec.width} × ${spec.depth} tiles`;
    document.getElementById("building-access")!.textContent = access?.road
      ? "Connected"
      : "No road";
    inspector.hidden = false;
    this.message(
      `${repository?.fullName ?? spec.name} selected · ${spec.width} × ${spec.depth} tiles.`,
    );
    this.drawSelection();
    this.ghost.clear();
  }

  private drawSelection(): void {
    this.selection.clear();
    this.selectionFootprint.clear();
    if (this.atlasActive) return;
    const building = this.world.buildings.find(
      (b) => b.id === this.selectedBuildingId,
    );
    if (!building) return;
    const spec = BUILDINGS[building.kind];
    const zoom = this.cameras.main.zoom;
    this.outline(
      this.selectionFootprint,
      building.x,
      building.y,
      spec.width,
      spec.depth,
      0xffda85,
      0.1,
      2.5 / zoom,
    );
    // Small screen-sized brackets identify the whole building, including its
    // roof, without tinting the artwork or adding another sprite to pick.
    const sprite = this.scenery.get(building.id);
    if (!sprite) return;
    const bounds = this.buildingBounds(sprite);
    const padding = 4 / zoom;
    const left = bounds.left - padding,
      right = bounds.right + padding;
    const top = bounds.top - padding,
      bottom = bounds.bottom + padding;
    const length = Math.min(12 / zoom, (right - left) / 4);
    this.selection.lineStyle(2 / zoom, 0xffda85, 1);
    for (const [x, y, dx, dy] of [
      [left, top, 1, 1],
      [right, top, -1, 1],
      [left, bottom, 1, -1],
      [right, bottom, -1, -1],
    ]) {
      this.selection.lineBetween(x, y, x + dx * length, y);
      this.selection.lineBetween(x, y, x, y + dy * length);
    }
  }

  private buildingBounds(
    sprite: Phaser.GameObjects.Image,
  ): Phaser.Geom.Rectangle {
    let trim = this.buildingBoundsCache.get(sprite.texture.key);
    if (!trim) {
      // Ignore transparent art padding and translucent shadows. Scan once per
      // building texture, not on every camera frame or pointer movement.
      const source = sprite.texture.getSourceImage() as HTMLCanvasElement;
      const pixels = source
        .getContext("2d", { willReadFrequently: true })!
        .getImageData(0, 0, source.width, source.height).data;
      let left = source.width,
        top = source.height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < source.height; y++) {
        for (let x = 0; x < source.width; x++) {
          if (pixels[(y * source.width + x) * 4 + 3] <= 100) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      trim =
        right < left
          ? new Phaser.Geom.Rectangle(0, 0, 1, 1)
          : new Phaser.Geom.Rectangle(
              left / source.width,
              top / source.height,
              (right - left + 1) / source.width,
              (bottom - top + 1) / source.height,
            );
      this.buildingBoundsCache.set(sprite.texture.key, trim);
    }
    const bounds = sprite.getBounds();
    return new Phaser.Geom.Rectangle(
      bounds.x + trim.x * bounds.width,
      bounds.y + trim.y * bounds.height,
      trim.width * bounds.width,
      trim.height * bounds.height,
    );
  }

  private focusSelection(): void {
    const sprite = this.selectedBuildingId
      ? this.scenery.get(this.selectedBuildingId)
      : undefined;
    if (!sprite) return;
    const bounds = sprite.getBounds();
    this.cameras.main.centerOn(bounds.centerX, bounds.centerY);
    this.syncVisible();
    this.refreshHover();
    this.drawSelection();
  }

  home(): void {
    if (this.atlasActive) return;
    this.homeCamera();
    this.syncVisible();
    this.drawGhost();
    this.updateStats();
  }
  private homeCamera(): void {
    const camera = this.cameras.main;
    const wide = camera.width >= 760;
    camera.setZoom(
      wide
        ? Math.min(1.15, (camera.width - 100) / 1330)
        : Math.min(0.7, camera.width / 780),
    );
    const at = coreProject(0, -1);
    camera.centerOn(at.x - (wide ? 24 : 0), at.y - (wide ? 0 : 50));
  }
  private zoom(factor: number, x?: number, y?: number): void {
    if (this.atlasActive) return;
    const c = this.cameras.main;
    if (factor < 1 && c.zoom * factor < 0.3 && this.onAtlasRequested) {
      this.onAtlasRequested();
      return;
    }
    const px = x ?? c.width / 2,
      py = y ?? c.height / 2;
    const before = c.getWorldPoint(px, py);
    c.zoom = Phaser.Math.Clamp(c.zoom * factor, 0.3, 2.2);
    c.preRender();
    const after = c.getWorldPoint(px, py);
    c.scrollX += before.x - after.x;
    c.scrollY += before.y - after.y;
    this.syncVisible();
    this.refreshHover();
    this.updateStats();
  }
  private cellScreen(x: number, y: number): { x: number; y: number } {
    const p = coreProject(x + 0.5, y + 0.5);
    return this.worldScreen(p.x, p.y);
  }
  private worldScreen(x: number, y: number): { x: number; y: number } {
    const c = this.cameras.main;
    return {
      x: (x - c.scrollX - c.width / 2) * c.zoom + c.width / 2,
      y: (y - c.scrollY - c.height / 2) * c.zoom + c.height / 2,
    };
  }
  private atPointer(pointer: Phaser.Input.Pointer) {
    const at = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.tool === "inspect" || this.tool === "bulldoze") {
      const candidates = this.world.buildings
        .map((b) => ({ b, sprite: this.scenery.get(b.id)! }))
        .filter(({ sprite }) => sprite?.visible)
        .sort(
          (a, b) =>
            b.sprite.depth - a.sprite.depth ||
            this.children.getIndex(b.sprite) - this.children.getIndex(a.sprite),
        );
      for (const { b, sprite } of candidates) {
        const bounds = sprite.getBounds();
        if (!bounds.contains(at.x, at.y)) continue;
        const texture = sprite.texture.getSourceImage() as HTMLCanvasElement;
        const px = Math.floor(
            ((at.x - bounds.x) / bounds.width) * texture.width,
          ),
          py = Math.floor(((at.y - bounds.y) / bounds.height) * texture.height);
        if (
          texture
            .getContext("2d", { willReadFrequently: true })!
            .getImageData(px, py, 1, 1).data[3] > 100
        )
          return { x: b.x, y: b.y };
      }
    }
    const cell = coreUnproject(at.x, at.y);
    return { x: Math.floor(cell.x), y: Math.floor(cell.y) };
  }
  private bindInput(): void {
    // A release over DOM controls emits pointerupoutside, while native touch
    // cancellation can otherwise reach Phaser as a normal pointerup. Neither
    // ends in an edit, and neither may leave a held gesture hiding the preview.
    const cancelGesture = () => this.cancelGesture();
    this.input.on("pointerupoutside", cancelGesture);
    window.addEventListener("pointercancel", cancelGesture, true);
    window.addEventListener("touchcancel", cancelGesture, true);
    window.addEventListener("blur", cancelGesture);
    this.cleanup.push(() => {
      window.removeEventListener("pointercancel", cancelGesture, true);
      window.removeEventListener("touchcancel", cancelGesture, true);
      window.removeEventListener("blur", cancelGesture);
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.atlasActive) return;
      const held = this.input.manager.pointers.filter((p) => p.isDown);
      if (held.length > 1) {
        this.pinch = {
          distance: Phaser.Math.Distance.Between(
            held[0].x,
            held[0].y,
            held[1].x,
            held[1].y,
          ),
          zoom: this.cameras.main.zoom,
        };
        if (this.drag) this.drag.moved = true;
        return;
      }
      this.drag = {
        id: p.id,
        x: p.x,
        y: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
      };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.atlasActive) return;
      const held = this.input.manager.pointers.filter((p) => p.isDown);
      if (this.pinch && held.length > 1) {
        const distance = Phaser.Math.Distance.Between(
          held[0].x,
          held[0].y,
          held[1].x,
          held[1].y,
        );
        this.zoom(
          (this.pinch.zoom * distance) /
            Math.max(1, this.pinch.distance) /
            this.cameras.main.zoom,
          (held[0].x + held[1].x) / 2,
          (held[0].y + held[1].y) / 2,
        );
        return;
      }
      if (this.drag?.id === p.id && p.isDown) {
        const d = this.drag;
        if (Math.hypot(p.x - d.x, p.y - d.y) > 6) d.moved = true;
        if (d.moved) {
          this.cameras.main.scrollX -= (p.x - d.lastX) / this.cameras.main.zoom;
          this.cameras.main.scrollY -= (p.y - d.lastY) / this.cameras.main.zoom;
        }
        d.lastX = p.x;
        d.lastY = p.y;
      }
      this.hovered = this.atPointer(p);
      this.drawGhost();
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.atlasActive) return;
      if (
        this.drag?.id === p.id &&
        !this.drag.moved &&
        !this.pinch &&
        p.leftButtonReleased()
      )
        this.edit(this.atPointer(p));
      this.drag = undefined;
      this.pinch = undefined;
    });
    this.input.on("gameout", () => {
      this.ghost.clear();
    });
    this.input.on(
      "wheel",
      (p: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) =>
        this.zoom(Math.exp(-dy * 0.001), p.x, p.y),
    );
    // Atlas layout changes must not recenter the retained city camera.
    const resize = () => {
      if (!this.atlasActive) this.home();
    };
    this.scale.on("resize", resize);
    this.cleanup.push(() => this.scale.off("resize", resize));
  }
  private cancelGesture(): void {
    this.drag = undefined;
    this.pinch = undefined;
    this.hovered = undefined;
    this.ghost?.clear();
  }
  private command(at: { x: number; y: number }) {
    if (this.tool === "road" || this.tool === "bulldoze")
      return { type: this.tool, ...at } as const;
    return {
      type: "building" as const,
      kind: this.tool as BuildingKind,
      ...at,
    };
  }
  private edit(at: { x: number; y: number }): void {
    if (this.atlasActive || (this.regionReadOnly && this.tool !== "inspect"))
      return;
    const cell = cellAt(this.world, at.x, at.y);
    if (this.tool === "inspect") {
      const building = this.world.buildings.find(
        (b) => b.id === cell?.occupant,
      );
      if (building) {
        this.selectBuilding(building.id);
        return;
      }
      this.clearSelection();
      if (!cell) {
        this.message("The town ends here. Drag to return to the neighborhood.");
        return;
      }
      this.message(
        cell.road
          ? "Road · connected streets guide the town’s vehicles."
          : cell.terrain === "water"
            ? "Water · keep roads and buildings on dry land."
            : "Open ground · ready for your next addition.",
      );
      return;
    }
    const command = this.command(at);
    const result = previewCommand(this.world, command);
    if (!result.ok) {
      this.message(result.message, true);
      return;
    }
    this.remember();
    const applied = applyCommand(this.world, command);
    if (!applied.ok) {
      this.undo.pop();
      this.message(applied.message, true);
      return;
    }
    this.dirty = true;
    this.clearSelection();
    this.rebuildTerrain(at);
    this.rebuildScenery();
    this.updateStats();
    this.drawGhost();
    this.message(applied.message);
  }
  private outline(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    d: number,
    color: number,
    alpha: number,
    lineWidth = 2,
  ): void {
    const pts = [
      coreProject(x, y),
      coreProject(x + w, y),
      coreProject(x + w, y + d),
      coreProject(x, y + d),
    ].map((p) => new Phaser.Math.Vector2(p.x, p.y));
    g.fillStyle(color, alpha).fillPoints(pts, true);
    g.lineStyle(lineWidth, color, 0.95).strokePoints(pts, true);
  }
  private refreshHover(): void {
    if (this.atlasActive) return;
    const p = this.input.activePointer;
    const bounds = this.game.canvas.getBoundingClientRect();
    const clientX = bounds.x + (p.x * bounds.width) / this.scale.width;
    const clientY = bounds.y + (p.y * bounds.height) / this.scale.height;
    if (document.elementFromPoint(clientX, clientY) !== this.game.canvas) {
      this.hovered = undefined;
      this.ghost.clear();
      return;
    }
    this.hovered = this.atPointer(p);
    this.drawGhost();
  }
  private drawGhost(): void {
    if (!this.ghost) return;
    this.ghost.clear();
    if (this.atlasActive || !this.hovered || this.drag?.moved) return;
    const { x, y } = this.hovered;
    if (!cellAt(this.world, x, y)) return;
    if (this.tool === "inspect") {
      // Explore has building hover, not a competing one-tile placement ghost.
      // Touch has no hover: retain only the selected building after a tap.
      if (this.input.activePointer.wasTouch) return;
      const id = cellAt(this.world, x, y)?.occupant;
      if (!id || id === this.selectedBuildingId) return;
      const building = this.world.buildings.find((b) => b.id === id);
      if (!building) return;
      const spec = BUILDINGS[building.kind];
      this.outline(
        this.ghost,
        building.x,
        building.y,
        spec.width,
        spec.depth,
        0xe9f4c6,
        0.08,
        1.5 / this.cameras.main.zoom,
      );
      return;
    }
    const spec =
      this.tool in BUILDINGS ? BUILDINGS[this.tool as BuildingKind] : undefined;
    const valid = previewCommand(this.world, this.command(this.hovered)).ok;
    this.outline(
      this.ghost,
      x,
      y,
      spec?.width ?? 1,
      spec?.depth ?? 1,
      valid ? 0xe9f4c6 : 0xe19479,
      0.22,
    );
    if (spec)
      this.outline(
        this.ghost,
        x + spec.access.x,
        y + spec.access.y,
        1,
        1,
        valid ? 0xe9f4c6 : 0xe19479,
        0.38,
      );
  }
  private rebuildTerrain(changed?: { x: number; y: number }): void {
    const w = this.world;
    for (let cy = 0; cy < w.height / CHUNK; cy++)
      for (let cx = 0; cx < w.width / CHUNK; cx++) {
        const x0 = w.minX + cx * CHUNK,
          y0 = w.minY + cy * CHUNK;
        if (
          changed &&
          (changed.x < x0 - 1 ||
            changed.x > x0 + CHUNK ||
            changed.y < y0 - 1 ||
            changed.y > y0 + CHUNK)
        )
          continue;
        const key = `${cx},${cy}`,
          texture = `core-chunk-${key}`;
        const old = this.chunks.get(key);
        if (old) {
          old.image.destroy();
          this.textures.remove(texture);
        }
        const g = this.make.graphics({ x: 0, y: 0 });
        const padding = 2,
          offset = (CHUNK * TILE_W) / 2 + padding;
        const origin = coreProject(x0, y0);
        g.translateCanvas(offset - origin.x, padding - origin.y);
        for (let y = 0; y < CHUNK; y++)
          for (let x = 0; x < CHUNK; x++) {
            const cell = cellAt(w, x0 + x, y0 + y);
            if (!cell) continue;
            drawTerrain(g, {
              x: x0 + x,
              y: y0 + y,
              terrain: cell.terrain,
              road: cell.road,
              roadMask: roadMask(w, x0 + x, y0 + y),
              waterMask: waterMask(w, x0 + x, y0 + y),
              elevation: cell.elevation,
              variant: Math.floor(this.hash(x0 + x, y0 + y) * 65536),
            });
          }
        g.generateTexture(
          texture,
          CHUNK * TILE_W + padding * 2,
          CHUNK * TILE_H + padding * 2,
        );
        g.destroy();
        const p = coreProject(x0, y0);
        const image = this.add
          .image(p.x - offset, p.y - padding, texture)
          .setOrigin(0, 0)
          .setDepth(-100000);
        this.chunks.set(key, { image, texture });
      }
    this.cameraKey = "";
  }
  private hash(x: number, y: number): number {
    let h =
      (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ this.world.seed) >>>
      0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  private rebuildScenery(): void {
    const wanted = new Set<string>();
    const stamp = (
      key: string,
      texture: string,
      x: number,
      y: number,
      width: number,
      height: number,
      ox: number,
      oy: number,
      depth: number,
    ) => {
      wanted.add(key);
      let image = this.scenery.get(key);
      if (!image) {
        image = this.pool.acquire();
        this.scenery.set(key, image);
      }
      image
        .setTexture(texture)
        .setPosition(x, y)
        .setOrigin(ox, oy)
        .setDisplaySize(width, height)
        .setDepth(depth)
        .setVisible(true);
    };
    for (const b of this.world.buildings) {
      const s = buildingSpriteSpec(b.kind),
        p = coreProject(b.x + s.anchor.x, b.y + s.anchor.y);
      stamp(
        b.id,
        s.texture,
        p.x,
        p.y,
        s.width,
        s.height,
        s.originX,
        s.originY,
        p.y,
      );
    }
    const s = treeSpriteSpec();
    for (let y = this.world.minY; y < this.world.minY + this.world.height; y++)
      for (
        let x = this.world.minX;
        x < this.world.minX + this.world.width;
        x++
      ) {
        const cell = cellAt(this.world, x, y)!;
        if (cell.road || cell.occupant || cell.terrain !== "grass") continue;
        const roll = this.hash(x, y),
          distance = Math.hypot(x, y);
        if (roll > (distance > 16 ? 0.15 : 0.045)) continue;
        const p = coreProject(x + 0.5, y + 0.5);
        stamp(
          `tree:${x},${y}`,
          s.texture,
          p.x,
          p.y,
          s.width * (0.8 + roll),
          s.height * (0.8 + roll),
          s.originX,
          s.originY,
          p.y,
        );
      }
    for (const [key, image] of this.scenery)
      if (!wanted.has(key)) {
        this.pool.release(image);
        this.scenery.delete(key);
      }
    this.cameraKey = "";
  }
  private updateCars(): void {
    if (this.atlasActive) return;
    const wanted = new Set<string>();
    for (const v of this.world.vehicles) {
      wanted.add(v.id);
      const pose = vehiclePose(this.world, v),
        spec = vehicleSpriteSpec(pose.heading),
        p = coreProject(pose.x, pose.y);
      let image = this.cars.get(v.id);
      if (!image) {
        image = this.pool.acquire();
        this.cars.set(v.id, image);
      }
      if (image.texture.key !== spec.texture)
        image
          .setTexture(spec.texture)
          .setOrigin(spec.originX, spec.originY)
          .setDisplaySize(spec.width, spec.height);
      if (image.x !== p.x || image.y !== p.y) image.setPosition(p.x, p.y);
      if (image.depth !== p.y + 0.1) image.setDepth(p.y + 0.1);
    }
    for (const [id, image] of this.cars)
      if (!wanted.has(id)) {
        this.pool.release(image);
        this.cars.delete(id);
      }
  }
  private syncVisible(): void {
    if (this.atlasActive) return;
    const c = this.cameras.main;
    c.preRender();
    const view = c.worldView;
    for (const { image } of this.chunks.values())
      image.setVisible(
        Phaser.Geom.Intersects.RectangleToRectangle(view, image.getBounds()),
      );
    for (const image of this.scenery.values())
      image.setVisible(
        Phaser.Geom.Intersects.RectangleToRectangle(view, image.getBounds()),
      );
  }
  private updateStats(): void {
    if (this.atlasActive) return;
    document.getElementById("building-count")!.textContent = String(
      this.world.buildings.length,
    );
    document.getElementById("vehicle-count")!.textContent = String(
      this.world.vehicles.length,
    );
    document.getElementById("zoom-level")!.textContent =
      `${Math.round(this.cameras.main.zoom * 100)}%`;
    const pause = document.querySelector<HTMLButtonElement>(
      "[data-action=pause]",
    )!;
    pause.setAttribute("aria-pressed", String(this.paused));
    pause.textContent = this.paused ? "▶ Resume" : "Ⅱ Pause";
    document.getElementById("save-state")!.textContent = this.regionReadOnly
      ? "Repository district"
      : this.dirty
        ? "Unsaved changes"
        : "Local town";
    document.querySelector<HTMLButtonElement>("[data-action=undo]")!.disabled =
      this.undo.length === 0;
    document.getElementById("sim-state")!.textContent = this.paused
      ? "Paused"
      : "Town in motion";
  }
  update(): void {
    if (!this.world) return;
    const now = performance.now(),
      elapsed = now - this.lastTime;
    this.lastTime = now;
    if (document.hidden) return; // Explicit policy: hidden tabs pause, never discard visible-time ticks.
    if (!this.paused) advanceWorld(this.world, elapsed);
    if (this.atlasActive) return;
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > 360) this.frameTimes.shift();
    const kb = this.input.keyboard;
    const editingUI = Boolean(
      document.querySelector("[popover]:popover-open") ||
        document.activeElement?.matches(
          "input, textarea, select, [contenteditable=true]",
        ),
    );
    const down = (key: string) => {
      const pressed =
        kb?.keys[
          (Phaser.Input.Keyboard.KeyCodes as unknown as Record<string, number>)[
            key
          ]
        ];
      // Browser/editor shortcuts such as Cmd/Ctrl+S also reach Phaser's key
      // state; saving a town must not simultaneously pan its camera south.
      return Boolean(
        pressed?.isDown &&
          !editingUI &&
          !pressed.ctrlKey &&
          !pressed.metaKey &&
          !pressed.altKey,
      );
    };
    const x =
        Number(down("D") || down("RIGHT")) - Number(down("A") || down("LEFT")),
      y = Number(down("S") || down("DOWN")) - Number(down("W") || down("UP"));
    if (x || y) {
      const dt = Math.min(elapsed, 100) / 1000;
      this.cameras.main.scrollX += (x * 500 * dt) / this.cameras.main.zoom;
      this.cameras.main.scrollY += (y * 500 * dt) / this.cameras.main.zoom;
      this.drawGhost();
    }
    if (!this.paused) this.updateCars();
    const c = this.cameras.main,
      key = `${c.scrollX}:${c.scrollY}:${c.zoom}:${c.width}:${c.height}`;
    if (key !== this.cameraKey) {
      this.syncVisible();
      this.refreshHover();
      this.drawSelection();
      this.cameraKey = key;
    }
    if (now - this.lastStats > 500) {
      this.lastStats = now;
      this.updateStats();
    }
  }
}
