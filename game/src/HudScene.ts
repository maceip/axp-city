import Phaser from "phaser";
import {
  censusRows,
  crewLabel,
  filterCensus,
  massPercent,
  sortCensus,
  type CensusRow,
  type CensusSortKey,
} from "../../src/game/census.js";
import { constructionLabel, constructionState } from "../../src/game/construction.js";
import type { Rect } from "../../src/game/visibility.js";
import type { CityFreshness, CitySnapshot } from "../../src/live/protocol.js";
import { project } from "../../src/render/iso.js";
import { HUD_FONT, HUD_FRAMES, HUD_SHEET } from "../../src/render/sprites.js";
import { yardLabel, yardPropList } from "../../src/rules/cityFiles.js";
import type { LotPlacement } from "../../src/world/layout.js";
import { SceneKeys } from "./Boot.js";
import type { ConnectionState } from "./connection.js";
import { ensureFrame } from "./stamps.js";

export interface HudActions {
  zoom(factor: number): void;
  home(): void;
  select(repo: string | undefined, frame?: boolean): void;
  move(x: number, y: number): void;
  jump(x: number, y: number): void;
  follow(): void;
  capture(): void;
  toggleMotion(): boolean;
}

const GOLD = "#f6dd91";
const INK = "#f2efe2";
const MUTED = "#b9c4b3";

/** Desktop kit and census stay city-first: the ledger is a sheet, not a curtain. */
const KIT_BTN_W = 118;
const KIT_BTN_H = 34;
const KIT_GAP = 6;
const CARD_W = 268;
const CENSUS_MIN_W = 392;
const CENSUS_MAX_W = 448;
const CENSUS_MAX_H = 540;

function tint(color: string): number {
  return Number.parseInt(color.replace("#", ""), 16);
}

/**
 * HUD copy uses a PIL-baked bitmap font. Chromium SwiftShader fillText
 * (and therefore Phaser Text) duplicates the last letters of each word.
 */
function ink(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: { fontSize?: string; color?: string; fontStyle?: string; wordWrap?: { width: number } } = {},
): Phaser.GameObjects.BitmapText {
  const size = Number.parseInt(style.fontSize ?? "12", 10);
  const label = scene.add.bitmapText(x, y, HUD_FONT.face, text, size);
  label.setTint(tint(style.color ?? INK));
  if (style.wordWrap) label.setMaxWidth(style.wordWrap.width);
  return label;
}

interface Button {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.BitmapText;
  width: number;
  height: number;
  name: string;
}

/**
 * HUD containers draw their contents from their local origin towards +x/+y,
 * but Phaser gives containers a centred origin and adds `displayOrigin`
 * (half the size) to the local point before testing a hit area. A hit
 * rectangle that matches the drawn plate therefore starts at (w/2, h/2).
 */
function plateHit(width: number, height: number): Phaser.Geom.Rectangle {
  return new Phaser.Geom.Rectangle(width / 2, height / 2, width, height);
}

/** Screen rectangle of a container's plate; `Container.getBounds()` ignores Graphics children. */
function frameOf(container: Phaser.GameObjects.Container): { x: number; y: number; width: number; height: number } {
  const m = container.getWorldTransformMatrix();
  return { x: m.tx, y: m.ty, width: container.width * m.scaleX, height: container.height * m.scaleY };
}

/**
 * The HUD is a Phaser scene layered over the city and reads the same snapshot
 * the city draws. Only the repository search field is a native <input>, so
 * mobile keyboards and screen readers get real text entry; `a11y.ts` mirrors
 * status, selection and the census into a visually hidden DOM region.
 */
export class HudScene extends Phaser.Scene {
  private actions!: HudActions;
  private snapshot!: CitySnapshot;
  private freshness?: CityFreshness;
  private connection: ConnectionState = "connecting";
  private connectionDetail?: string;
  private clockOffset = 0;
  private selected?: LotPlacement;
  private buttons = new Map<string, Button>();
  private plate!: Phaser.GameObjects.Container;
  private district!: Phaser.GameObjects.BitmapText;
  private coords!: Phaser.GameObjects.BitmapText;
  private statusDot!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.BitmapText;
  private freshText!: Phaser.GameObjects.BitmapText;
  private countText!: Phaser.GameObjects.BitmapText;
  private compass!: Phaser.GameObjects.Container;
  private massBar!: Phaser.GameObjects.Graphics;
  private massLabel!: Phaser.GameObjects.BitmapText;
  private massContainer!: Phaser.GameObjects.Container;
  private zoomText!: Phaser.GameObjects.BitmapText;
  private minimap!: Phaser.GameObjects.Container;
  private minimapPlan!: Phaser.GameObjects.Graphics;
  private minimapView!: Phaser.GameObjects.Graphics;
  private minimapBounds = { x: 0, y: 0, width: 1, height: 1 };
  private minimapSize = { w: 180, h: 118 };
  private minimapBg!: Phaser.GameObjects.Image;
  private card!: Phaser.GameObjects.Container;
  private cardBg!: Phaser.GameObjects.Image;
  private cardTexts: Phaser.GameObjects.BitmapText[] = [];
  private census!: Phaser.GameObjects.Container;
  private censusBg!: Phaser.GameObjects.Image;
  private censusRowsTexts: Phaser.GameObjects.BitmapText[] = [];
  private censusHeader: Phaser.GameObjects.BitmapText[] = [];
  private censusMarks: Phaser.GameObjects.GameObject[] = [];
  private censusOpen = false;
  private censusScroll = 0;
  private censusSort: { key: CensusSortKey; descending: boolean } = { key: "stars", descending: true };
  private censusFilter = "";
  private censusVisible: CensusRow[] = [];
  private toastText!: Phaser.GameObjects.BitmapText;
  private toastBg!: Phaser.GameObjects.Image;
  private toastTimer?: Phaser.Time.TimerEvent;
  private tag!: Phaser.GameObjects.BitmapText;
  private tagPlate!: Phaser.GameObjects.Image;
  private hint!: Phaser.GameObjects.BitmapText;
  private hintPlate!: Phaser.GameObjects.Image;
  private dpad!: Phaser.GameObjects.Container;
  private tools!: Phaser.GameObjects.Container;
  private kitRail!: Phaser.GameObjects.Image;
  private mast!: Phaser.GameObjects.Image;
  private listeners = new Set<(event: string, detail?: unknown) => void>();
  private constructionStamp?: string;
  private lastView?: Rect;
  motion = true;

  constructor() {
    super({ key: SceneKeys.Hud, active: false });
  }

  init(data: { actions: HudActions; snapshot: CitySnapshot }): void {
    this.actions = data.actions;
    this.snapshot = data.snapshot;
  }

  /** Events for the DOM accessibility mirror: selection, census, status. */
  on(listener: (event: string, detail?: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: string, detail?: unknown): void {
    for (const listener of this.listeners) listener(event, detail);
  }

  /** Construction-city survey plaques from the civic HUD kit. */
  private hudPanel(frame: keyof typeof HUD_FRAMES, width: number, height: number): Phaser.GameObjects.Image {
    const box = HUD_FRAMES[frame];
    const img = this.add.image(0, 0, HUD_SHEET.file, ensureFrame(this, HUD_SHEET.file, box));
    img.setOrigin(0, 0).setDisplaySize(width, height);
    img.disableInteractive();
    return img;
  }

  create(): void {
    // Same instance after a restart (context loss): drop references to objects
    // the previous display list destroyed.
    this.buttons = new Map();
    this.cardTexts = [];
    this.censusRowsTexts = [];
    this.censusHeader = [];
    this.censusMarks = [];
    this.censusOpen = false;
    this.censusScroll = 0;
    this.censusVisible = [];
    this.selected = undefined;
    this.toastTimer = undefined;
    this.lastView = undefined;
    this.constructionStamp = undefined;
    this.cameras.main.setRoundPixels(true);
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    this.mast = this.hudPanel("rail", 900, 86);
    this.mast.setName("mast");
    this.plate = this.add.container(16, 16);
    const plateBg = this.hudPanel("plate", 250, 78);
    const title = ink(this, 14, 12, "SURVEY DESK", { fontSize: "11px", color: GOLD });
    this.district = ink(this, 14, 30, "Central Park", { fontSize: "18px", fontStyle: "bold" });
    this.coords = ink(this, 14, 55, "0 · 0", { fontSize: "11px", color: MUTED });
    this.plate.add([plateBg, title, this.district, this.coords]);
    this.plate.setSize(250, 78).setName("plate");

    // Connection and freshness are separate readings.
    const status = this.add.container(0, 16);
    status.setSize(320, 62);
    const statusBg = this.hudPanel("status", 320, 62);
    this.statusDot = this.add.graphics();
    this.statusText = ink(this, 30, 10, "Connecting", { fontSize: "13px" });
    this.freshText = ink(this, 14, 30, "GitHub data: —", { fontSize: "11px", color: MUTED });
    this.countText = ink(this, 14, 45, "", { fontSize: "11px", color: MUTED });
    status.add([statusBg, this.statusDot, this.statusText, this.freshText, this.countText]);
    status.setName("status");
    this.tools = status;

    this.compass = this.add.container(0, 92);
    const ring = this.hudPanel("compass", 52, 52);
    const n = ink(this, 38, 2, "N", { fontSize: "10px", color: GOLD, fontStyle: "bold" });
    const w = ink(this, 6, 24, "W", { fontSize: "9px", color: MUTED });
    const e = ink(this, 40, 24, "E", { fontSize: "9px", color: MUTED });
    const s = ink(this, 12, 42, "S", { fontSize: "9px", color: MUTED });
    this.compass.add([ring, n, w, e, s]);
    // Circle centre is offset by the display origin like plateHit() rectangles.
    this.compass.setSize(52, 52).setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Circle(52, 52, 26), hitAreaCallback: Phaser.Geom.Circle.Contains });
    this.compass.on("pointerup", () => this.actions.home());
    this.compass.setName("compass");

    this.massContainer = this.add.container(0, 92);
    const massBg = this.hudPanel("mass", 186, 44);
    this.massLabel = ink(this, 12, 8, "MASS —", { fontSize: "10px", color: GOLD });
    this.massBar = this.add.graphics();
    this.massContainer.add([massBg, this.massLabel, this.massBar]);
    this.massContainer.setSize(186, 44).setName("mass");
    this.drawMass(undefined);

    this.zoomText = ink(this, 0, 0, "100%", { fontSize: "12px" }).setOrigin(0.5);
    this.button("zoom-out", "−", 40, 40, () => this.actions.zoom(1 / 1.2));
    this.button("zoom-in", "+", 40, 40, () => this.actions.zoom(1.2));

    this.minimap = this.add.container(0, 0);
    this.minimapBg = this.hudPanel("minimap", this.minimapSize.w + 12, this.minimapSize.h + 30);
    this.minimapBg.setPosition(-6, -6);
    this.minimapPlan = this.add.graphics();
    this.minimapView = this.add.graphics();
    const mapLabel = ink(this, this.minimapSize.w / 2, this.minimapSize.h + 8, "CITY OVERVIEW · drag to travel", {
      fontSize: "9px",
      color: MUTED,
    }).setOrigin(0.5, 0);
    this.minimap.add([this.minimapBg, this.minimapPlan, this.minimapView, mapLabel]);
    this.minimap.setSize(this.minimapSize.w, this.minimapSize.h);
    this.minimap.setInteractive({
      hitArea: plateHit(this.minimapSize.w, this.minimapSize.h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    const jump = (p: Phaser.Input.Pointer) => {
      const lx = p.x - this.minimap.x,
        ly = p.y - this.minimap.y;
      this.actions.jump(
        this.minimapBounds.x + (lx / this.minimapSize.w) * this.minimapBounds.width,
        this.minimapBounds.y + (ly / this.minimapSize.h) * this.minimapBounds.height,
      );
    };
    this.minimap.on("pointerdown", jump);
    this.minimap.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (p.isDown) jump(p);
    });
    this.minimap.setName("minimap");

    this.dpad = this.add.container(0, 0).setSize(150, 150).setName("dpad");
    const pad = this.hudPanel("dpad", 150, 150);
    this.dpad.add(pad);
    const dirs: Array<[string, string, number, number, number, number]> = [
      ["move-north", "↑", 52, 4, 0, -1],
      ["move-west", "←", 4, 52, -1, 0],
      ["move-east", "→", 100, 52, 1, 0],
      ["move-south", "↓", 52, 100, 0, 1],
    ];
    for (const [name, label, x, y, dx, dy] of dirs) {
      const b = this.button(name, label, 46, 46, () => {});
      b.container.setPosition(x, y);
      b.container.removeAllListeners("pointerup");
      b.container.on("pointerdown", () => this.actions.move(dx, dy));
      b.container.on("pointerup", () => this.actions.move(0, 0));
      b.container.on("pointerout", () => this.actions.move(0, 0));
      this.dpad.add(b.container);
    }
    const home = this.button("home", "⌂", 46, 46, () => this.actions.home());
    home.container.setPosition(52, 52);
    this.dpad.add(home.container);

    this.hintPlate = this.hudPanel("toast", 760, 26);
    this.hintPlate.setName("hint-plate");
    this.hint = ink(this, 0, 0, "FIELD NOTES · drag · scroll/pinch · WASD · / search · C census · F follow · Esc", {
      fontSize: "11px",
      color: "#efe6c8",
    }).setOrigin(0, 1);
    this.kitRail = this.hudPanel("rail", KIT_BTN_W + 12, 180);
    this.kitRail.setName("kit-rail");
    this.button("census", "CENSUS", KIT_BTN_W, KIT_BTN_H, () => this.toggleCensus());
    this.button("capture", "CAPTURE", KIT_BTN_W, KIT_BTN_H, () => this.actions.capture());
    this.button("svg", "SVG MAP", KIT_BTN_W, KIT_BTN_H, () => window.open(document.querySelector<HTMLMetaElement>('meta[name="city-svg"]')?.content || "/api/city/export.svg", "_blank", "noopener"));
    this.button("motion", "MOTION ON", KIT_BTN_W, KIT_BTN_H, () => {
      this.motion = this.actions.toggleMotion();
      this.buttons.get("motion")!.label.setText(this.motion ? "MOTION ON" : "MOTION OFF");
      this.emit("motion", this.motion);
    });
    this.button("follow", "FOLLOW", KIT_BTN_W, KIT_BTN_H, () => this.actions.follow());

    this.card = this.add.container(0, 0).setVisible(false).setName("card");
    this.cardBg = this.hudPanel("card", CARD_W, 260);
    this.card.add(this.cardBg);
    const close = this.button("close-card", "×", 32, 32, () => this.actions.select(undefined));
    this.card.add(close.container);
    const open = this.button("open-repo", "View repository ↗", 170, 34, () => {
      if (this.selected) window.open(this.selected.lot.url, "_blank", "noopener,noreferrer");
    });
    this.card.add(open.container);

    this.census = this.add.container(0, 0).setVisible(false).setName("census-panel");
    this.censusBg = this.hudPanel("census", 900, 120);
    this.census.add(this.censusBg);
    const closeCensus = this.button("close-census", "×", 32, 32, () => this.toggleCensus(false));
    this.census.add(closeCensus.container);

    this.toastBg = this.hudPanel("toast", 360, 48).setOrigin(0.5, 1).setVisible(false).setDepth(49);
    this.toastText = ink(this, 0, 0, "", { fontSize: "13px" }).setOrigin(0.5, 1).setVisible(false).setDepth(50);
    this.tagPlate = this.hudPanel("toast", 180, 26).setVisible(false).setDepth(59);
    this.tag = ink(this, 0, 0, "", { fontSize: "12px" }).setVisible(false).setDepth(60);

    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.censusOpen && contains(frameOf(this.census), p.x, p.y)) {
        this.censusScroll = Math.max(0, this.censusScroll + Math.sign(dy) * 2);
        this.renderCensus();
      }
    });
    this.scale.on("resize", () => this.layout());
    this.layout();
    this.setSnapshot(this.snapshot);
    this.events.once("shutdown", () => {
      this.scale.off("resize");
      this.listeners.clear();
    });
  }

  update(): void {
    if (!this.selected) {
      this.constructionStamp = undefined;
      return;
    }
    const site = constructionState(this.selected, this.now());
    const stamp = `${site.stage}:${Math.round(site.progress * 50)}`;
    if (stamp !== this.constructionStamp) this.setSelection(this.selected);
  }

  private button(name: string, text: string, width: number, height: number, onClick: () => void): Button {
    const container = this.add.container(0, 0);
    const frame = height >= 40 && width <= 50 ? "btn-sq" : width >= 110 ? "btn-wide" : "btn";
    const img = this.hudPanel(frame, width, height);
    const bg = this.add.graphics();
    const label = ink(this, width / 2, height / 2, text, { fontSize: height >= 40 ? "18px" : "14px" }).setOrigin(0.5);
    const paint = (hover: boolean) => {
      img.setTint(hover ? 0xf0e0a0 : 0xffffff);
      bg.clear();
    };
    paint(false);
    container.add([img, bg, label]);
    container.setSize(width, height);
    container.setInteractive({ hitArea: plateHit(width, height), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
    container.on("pointerover", () => paint(true));
    container.on("pointerout", () => paint(false));
    container.on("pointerup", () => onClick());
    container.setName(name);
    const button = { container, bg, label, width, height, name };
    this.buttons.set(name, button);
    return button;
  }

  /** Small screens stack the card as a bottom sheet and shrink the map tools. */
  private layout(): void {
    const W = this.scale.width,
      H = this.scale.height;
    const small = W < 700;
    this.mast.setVisible(!small);
    this.mast.setPosition(10, 10);
    this.mast.setDisplaySize(W - 20, 86);
    this.tools.setPosition(W - 336, 16);
    // Desktop MASS lives on the inspect card; the extra plate covered the city.
    const mapW = small ? 120 : 180,
      mapH = small ? 78 : 118;
    if (mapW !== this.minimapSize.w) {
      this.minimapSize = { w: mapW, h: mapH };
      this.minimapBg.setDisplaySize(mapW + 12, mapH + 30);
      (this.minimap.list[3] as Phaser.GameObjects.BitmapText).setPosition(mapW / 2, mapH + 8);
      this.minimap.setSize(mapW, mapH);
      (this.minimap.input!.hitArea as Phaser.Geom.Rectangle).setTo(mapW / 2, mapH / 2, mapW, mapH);
      this.drawMinimapPlan();
    }
    this.minimap.setPosition(W - mapW - 22, H - mapH - 46);
    const zoomY = H - mapH - 100;
    this.buttons.get("zoom-out")!.container.setPosition(W - mapW - 22, zoomY);
    this.zoomText.setPosition(W - mapW - 22 + 40 + 34, zoomY + 20);
    this.buttons.get("zoom-in")!.container.setPosition(W - mapW - 22 + 108, zoomY);
    this.dpad.setPosition(16, H - 166);
    this.dpad.setScale(small ? 0.85 : 1);
    // A phone's bottom-sheet card covers the d-pad; it returns when the card closes.
    this.dpad.setVisible(!(small && this.card.visible));
    const toolbar = ["census", "capture", "svg", "motion", "follow"];
    const hintOn = !small && !this.censusOpen && W >= 1100;
    this.hint.setOrigin(0, 1).setPosition(198, H - 58).setVisible(hintOn);
    this.hintPlate.setOrigin(0, 1).setPosition(186, H - 54).setDisplaySize(Math.min(780, W - 420), 26).setVisible(hintOn);
    if (small) {
      this.kitRail.setVisible(false);
      this.massContainer.setVisible(!this.card.visible && !this.censusOpen);
      this.compass.setPosition(W - 60, 92);
      this.massContainer.setPosition(W - 210, 92);
      const y0 = H - 248;
      let x = 16;
      for (const name of ["census", "capture", "svg"]) {
        const b = this.buttons.get(name)!;
        b.container.setVisible(true);
        b.container.setScale(0.82);
        b.container.setPosition(x, y0);
        x += b.width * 0.82 + 6;
      }
      x = 16;
      for (const name of ["motion", "follow"]) {
        const b = this.buttons.get(name)!;
        b.container.setVisible(true);
        b.container.setScale(0.82);
        b.container.setPosition(x, y0 + 36);
        x += b.width * 0.82 + 6;
      }
    } else {
      const kitW = KIT_BTN_W;
      const kitX = W - mapW - 22 - kitW - 10;
      const kitH = toolbar.length * (KIT_BTN_H + KIT_GAP) - KIT_GAP;
      // Bottom-align with the minimap so Follow stays on-screen.
      const kitY = H - 46 - kitH;
      this.massContainer.setVisible(false);
      this.compass.setPosition(W - 64, kitY - 8);
      const hideDock = this.censusOpen;
      this.kitRail.setVisible(!hideDock);
      this.kitRail.setPosition(kitX - 6, kitY - 8);
      this.kitRail.setDisplaySize(kitW + 12, kitH + 16);
      let y = kitY;
      for (const name of toolbar) {
        const b = this.buttons.get(name)!;
        b.container.setScale(1);
        const show = !hideDock || name === "census";
        b.container.setVisible(show);
        if (!show) continue;
        b.container.setPosition(kitX, hideDock ? H - 46 - KIT_BTN_H - 8 : y);
        y += b.height + KIT_GAP;
      }
    }
    this.toastBg.setPosition(W / 2, H - (small ? 230 : 70));
    this.toastText.setPosition(W / 2, H - (small ? 230 : 70));
    this.layoutCard();
    this.layoutCensus();
    this.emit("layout", { small });
  }

  setSnapshot(snapshot: CitySnapshot): void {
    this.snapshot = snapshot;
    this.clockOffset = Date.parse(snapshot.serverTime) - Date.now();
    this.freshness = snapshot.freshness;
    this.countText.setText(`${snapshot.plan.placements.length.toLocaleString()} repositories · ${snapshot.mode === "offline" ? "fixture mode" : "live mode"} · r${snapshot.revision}`);
    this.drawMinimapPlan();
    this.drawStatus();
    if (this.selected) {
      const again = snapshot.plan.placements.find((p) => p.lot.fullName === this.selected!.lot.fullName);
      if (again) this.setSelection(again);
      else this.setSelection(undefined);
    }
    if (this.censusOpen) this.renderCensus();
    this.emit("snapshot", snapshot);
  }

  setConnection(state: ConnectionState, detail?: string): void {
    this.connection = state;
    this.connectionDetail = detail;
    this.drawStatus();
  }

  setFreshness(freshness: CityFreshness): void {
    this.freshness = freshness;
    this.drawStatus();
  }

  private now(): number {
    return Date.now() + this.clockOffset;
  }

  /** Connection colour is separate from data freshness: connected ≠ fresh. */
  private drawStatus(): void {
    const mode = this.snapshot?.mode;
    const labels: Record<ConnectionState, string> = {
      connecting: "Connecting…",
      connected: mode === "offline" ? "Connected · offline demo" : "Connected · live city",
      reconnecting: "Reconnecting…",
      resynchronizing: "Resynchronizing…",
      unavailable: this.connectionDetail ?? "City data unavailable",
      "offline-package": "Saved city package",
    };
    this.statusText.setText(labels[this.connection]);
    const colour =
      this.connection === "connected" ? (mode === "offline" ? 0xe0b34a : 0x7ee081) : this.connection === "offline-package" ? 0xb9c4b3 : 0xe07a5f;
    this.statusDot.clear().fillStyle(colour, 1).fillCircle(18, 17, 5);
    const f = this.freshness;
    let fresh = "GitHub data: —";
    let freshColour = MUTED;
    if (f) {
      if (f.source === "fixture") fresh = "Recorded fixture data · not live GitHub";
      else if (f.lastSuccessfulRefreshAt) {
        const age = this.now() - Date.parse(f.lastSuccessfulRefreshAt);
        const stale = age > f.staleAfterMs;
        fresh = `GitHub refresh ${ageLabel(age)} ago${stale ? " · STALE" : ""}${f.failingRepositories ? ` · ${f.failingRepositories} failing` : ""}`;
        freshColour = stale || f.failingRepositories ? "#f2b36b" : "#9fdc9a";
        if (f.lastError && f.lastFailureAt && Date.parse(f.lastFailureAt) > Date.parse(f.lastSuccessfulRefreshAt)) {
          fresh += ` · last error ${ageLabel(this.now() - Date.parse(f.lastFailureAt))} ago`;
          freshColour = "#f2b36b";
        }
      } else {
        fresh = f.lastError ? `No successful GitHub refresh yet · ${f.lastError}` : "No GitHub refresh yet";
        freshColour = "#f2b36b";
      }
    }
    this.freshText.setText(fresh.length > 50 ? `${fresh.slice(0, 49)}…` : fresh);
    this.freshText.setTint(tint(freshColour));
    this.emit("status", { connection: labels[this.connection], freshness: fresh });
  }

  setCamera(view: Rect, zoom: number, district: string, x: number, y: number): void {
    this.lastView = view;
    this.zoomText.setText(`${Math.round(zoom * 100)}%`);
    if (this.district.text !== district) this.district.setText(district);
    this.coords.setText(`${Math.round(x)} · ${Math.round(y)} · ${Math.round(zoom * 100)}%`);
    this.drawMinimapView();
  }

  private drawMinimapPlan(): void {
    const plan = this.snapshot.plan,
      b = plan.bounds;
    const corners = [project(b.minX, b.minY), project(b.maxX, b.minY), project(b.minX, b.maxY), project(b.maxX, b.maxY)];
    const xs = corners.map((p) => p.sx),
      ys = corners.map((p) => p.sy);
    const minX = Math.min(...xs) - 80,
      minY = Math.min(...ys) - 100,
      maxX = Math.max(...xs) + 80,
      maxY = Math.max(...ys) + 80;
    this.minimapBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const { w, h } = this.minimapSize;
    const px = (x: number) => ((x - minX) / (maxX - minX)) * w,
      py = (y: number) => ((y - minY) / (maxY - minY)) * h;
    const g = this.minimapPlan;
    g.clear();
    g.fillStyle(0x8fa07a, 1).fillRect(0, 0, w, h);
    for (const f of plan.features) {
      const fill =
        f.kind === "river"
          ? 0x6a9094
          : f.kind === "park"
            ? 0x6e8658
            : f.kind === "plaza"
              ? 0xc4b69a
              : f.kind === "office"
                ? 0xc9b56a
                : f.kind === "bike"
                  ? 0xa89c68
                  : f.kind === "freeway"
                    ? 0x52606b
                    : 0x768270;
      g.fillStyle(fill, 1);
      const pts = [project(f.x, f.y), project(f.x + f.w, f.y), project(f.x + f.w, f.y + f.h), project(f.x, f.y + f.h)].map(
        (p) => new Phaser.Math.Vector2(px(p.sx), py(p.sy)),
      );
      g.fillPoints(pts, true);
    }
    for (const p of plan.placements) {
      const a = project(p.x + 1, p.y + 1);
      g.fillStyle(p.lot.fullName === this.selected?.lot.fullName ? 0xfff6cd : p.lot.recentActivity ? 0x3e5a3d : 0x6f7f68, 1);
      g.fillRect(px(a.sx) - 1, py(a.sy) - 1, 3, 3);
    }
    this.drawMinimapView();
  }

  private drawMinimapView(): void {
    const view = this.lastView;
    if (!view) return;
    const { w, h } = this.minimapSize,
      b = this.minimapBounds;
    const g = this.minimapView;
    g.clear();
    g.lineStyle(1.5, 0xf9f1cb, 1);
    g.strokeRect(((view.x - b.x) / b.width) * w, ((view.y - b.y) / b.height) * h, (view.width / b.width) * w, (view.height / b.height) * h);
  }

  private drawMass(place: LotPlacement | undefined): void {
    const pct = massPercent(place?.lot.buildingBand);
    this.massLabel.setText(place ? `MASS · ${place.lot.buildingBand} BUILDING · ${place.lot.stars.toLocaleString()} ★` : "MASS — select a building");
    this.massBar.clear();
    this.massBar.fillStyle(0x2a2f2c, 1).fillRoundedRect(12, 26, 162, 8, 3);
    if (pct) this.massBar.fillStyle(0xf6dd91, 1).fillRoundedRect(12, 26, 1.62 * pct, 8, 3);
  }

  /** One selection for the whole client: card, MASS bar, minimap marker and mirror. */
  setSelection(place: LotPlacement | undefined): void {
    this.selected = place;
    this.drawMass(place);
    this.drawMinimapPlan();
    for (const t of this.cardTexts) t.destroy();
    this.cardTexts = [];
    if (!place) {
      this.card.setVisible(false);
      this.layout();
      this.emit("selection", undefined);
      return;
    }
    const lot = place.lot;
    const site = constructionState(place, this.now());
    this.constructionStamp = `${site.stage}:${Math.round(site.progress * 50)}`;
    const lines: Array<[string, string, string?]> = [
      [`${place.district.toUpperCase()} · ${lot.buildingBand} BUILDING · SLOT ${place.col},${place.row}`, GOLD, "10px"],
      [lot.name, INK, "20px"],
      [`${lot.owner} / ${lot.name}`, MUTED, "11px"],
      [`STARS ${lot.stars.toLocaleString()}    ISSUES ${lot.openIssues}    OPEN PRS ${lot.openPrs}`, INK, "12px"],
      [site.stage !== "complete" ? `UNDER CONSTRUCTION · ${constructionLabel(site).toUpperCase()} · ${Math.round(site.progress * 100)}%` : yardLabel(lot.yard).toUpperCase(), GOLD, "11px"],
      [`${crewLabel(lot)} — ${lot.crewBasis}`, INK, "11px"],
      [`Loading zone: ${yardPropList(lot).concat(lot.extraProps ?? []).join(", ") || "ready for its next delivery"}${lot.layout ? ` · ${lot.layout.bays} bay${lot.layout.bays > 1 ? "s" : ""}` : ""}`, MUTED, "11px"],
      [
        `${lot.dataSource === "fixture" ? "Recorded fixture" : "GitHub data"}${lot.fetchedAt ? ` · ${new Date(lot.fetchedAt).toLocaleString()}` : ""}${lot.partial?.carriedFields.length ? ` · PARTIAL: ${lot.partial.carriedFields.join(", ")} carried from ${lot.partial.carriedFrom ? new Date(lot.partial.carriedFrom).toLocaleDateString() : "an earlier refresh"}` : ""}`,
        lot.partial?.carriedFields.length ? "#f2b36b" : MUTED,
        "10px",
      ],
      [`${lot.rulesSource === "repository" ? "Repository rules" : "City default rules"}${lot.artwork ? " · approved artwork" : ""}${lot.rulesWarning ? ` · ${lot.rulesWarning}` : ""}`, lot.rulesWarning ? "#f2b36b" : MUTED, "10px"],
    ];
    const width = this.cardWidth();
    let y = 44;
    for (const [text, color, size] of lines) {
      const t = ink(this, 16, y, text, { fontSize: size ?? "12px", color, wordWrap: { width: width - 32 } });
      this.card.add(t);
      this.cardTexts.push(t);
      y += t.height + 6;
    }
    this.card.setData("height", y + 52);
    this.card.setVisible(!this.censusOpen);
    if (this.card.visible) this.layoutCard();
    else this.layout();
    this.emit("selection", { place, lines: lines.map((l) => l[0]) });
  }

  private cardWidth(): number {
    return this.scale.width < 700 ? this.scale.width - 24 : CARD_W;
  }

  private layoutCard(): void {
    if (!this.card.visible) return;
    const W = this.scale.width,
      H = this.scale.height,
      small = W < 700;
    const width = this.cardWidth();
    const height = (this.card.getData("height") as number) ?? 200;
    const x = small ? 12 : W - width - 16;
    const y = small ? Math.max(90, H - height - 12) : 150;
    this.card.setPosition(x, y).setSize(width, height);
    this.cardBg.setDisplaySize(width, height);
    this.buttons.get("close-card")!.container.setPosition(width - 40, 8);
    this.buttons.get("open-repo")!.container.setPosition(16, height - 44);
    if (small) {
      this.dpad.setVisible(false);
      this.hint.setVisible(false);
      this.hintPlate.setVisible(false);
    }
    this.card.setDepth(40);
  }

  get cardVisible(): boolean {
    return this.card.visible;
  }
  get cardBottom(): number {
    return this.card.visible ? this.card.y : this.scale.height;
  }

  // ---- Census ------------------------------------------------------------
  toggleCensus(open = !this.censusOpen): void {
    this.censusOpen = open;
    this.census.setVisible(open);
    this.censusScroll = 0;
    // Ledger + inspect card together buried the city; keep one overlay.
    this.card.setVisible(Boolean(this.selected) && !open);
    if (open) this.renderCensus();
    this.layout();
    this.emit("census", open);
  }
  get censusIsOpen(): boolean {
    return this.censusOpen;
  }

  censusFrame(): { x: number; y: number; width: number; height: number } | null {
    if (!this.censusOpen) return null;
    return frameOf(this.census);
  }

  setCensusFilter(query: string): void {
    this.censusFilter = query;
    this.censusScroll = 0;
    if (this.censusOpen) this.renderCensus();
  }

  private sortBy(key: CensusSortKey): void {
    this.censusSort = key === this.censusSort.key ? { key, descending: !this.censusSort.descending } : { key, descending: key !== "repo" && key !== "district" };
    this.censusScroll = 0;
    this.renderCensus();
  }

  private layoutCensus(): void {
    if (!this.censusOpen) return;
    const W = this.scale.width,
      H = this.scale.height;
    const small = W < 700;
    if (small) {
      const height = Math.min(H * 0.5, 420);
      this.census.setPosition(0, H - height).setSize(W, height);
      this.censusBg.setDisplaySize(W, height);
      this.buttons.get("close-census")!.container.setPosition(W - 44, 8);
    } else {
      const width = Math.min(CENSUS_MAX_W, Math.max(CENSUS_MIN_W, Math.round(W * 0.28)));
      const height = Math.min(H - 120, CENSUS_MAX_H);
      this.census.setPosition(16, 98).setSize(width, height);
      this.censusBg.setDisplaySize(width, height);
      this.buttons.get("close-census")!.container.setPosition(width - 44, 8);
    }
    this.census.setDepth(45);
    this.renderCensus();
  }

  columns(): Array<{ key: CensusSortKey | "crew" | "yard" | "props"; label: string; width: number }> {
    const small = this.scale.width < 700;
    return small
      ? [
          { key: "repo", label: "Repo", width: 180 },
          { key: "stars", label: "Stars", width: 64 },
          { key: "prs", label: "PRs", width: 44 },
          { key: "band", label: "Bld", width: 44 },
          { key: "crew", label: "Crew", width: 100 },
        ]
      : [
          { key: "repo", label: "Repository", width: 148 },
          { key: "district", label: "District", width: 80 },
          { key: "stars", label: "Stars", width: 52 },
          { key: "prs", label: "PRs", width: 36 },
          { key: "band", label: "Bld", width: 32 },
          { key: "crew", label: "Crew", width: 72 },
        ];
  }

  private censusMetrics(): { small: boolean; rowH: number; font: number; head: number; headerY: number } {
    const small = this.scale.width < 700;
    return { small, rowH: small ? 26 : 32, font: small ? 12 : 14, head: small ? 12 : 13, headerY: small ? 72 : 90 };
  }

  private clipCell(value: string, width: number, fontSize: number): string {
    const advance = 19 * (fontSize / 32);
    const chars = Math.max(3, Math.floor(width / advance) - 1);
    return value.length > chars ? `${value.slice(0, chars - 1)}…` : value;
  }

  private renderCensus(): void {
    for (const t of [...this.censusRowsTexts, ...this.censusHeader, ...this.censusMarks]) t.destroy();
    this.censusRowsTexts = [];
    this.censusHeader = [];
    this.censusMarks = [];
    const rows = sortCensus(filterCensus(censusRows(this.snapshot.plan, this.now()), this.censusFilter), this.censusSort.key, this.censusSort.descending);
    this.censusVisible = rows;
    const H = Math.max(160, this.census.height || Math.min(this.scale.height * 0.5, 420));
    const width = Math.max(280, this.census.width || 580);
    const { rowH, font, head, headerY } = this.censusMetrics();
    const visibleRows = Math.max(1, Math.floor((H - headerY - 28) / rowH));
    this.censusScroll = Math.min(this.censusScroll, Math.max(0, rows.length - visibleRows));
    const titleBand = this.add.rectangle(12, 10, width - 24, 56, 0x2a2e26, 0.72).setOrigin(0, 0);
    this.census.add(titleBand);
    this.censusMarks.push(titleBand);
    const title = ink(this, 18, 14, "LOT CENSUS", { fontSize: "15px", color: GOLD });
    const filter = this.censusFilter ? ` matching “${this.censusFilter}”` : "";
    const meta = ink(
      this,
      18,
      38,
      `${rows.length} of ${this.snapshot.plan.placements.length}${filter} · ${this.censusSort.key} ${this.censusSort.descending ? "↓" : "↑"} · scroll or ↑↓ · Enter inspect`,
      { fontSize: "12px", color: MUTED },
    );
    this.census.add([title, meta]);
    this.censusHeader.push(title, meta);
    const headBand = this.add.rectangle(12, headerY - 8, width - 24, 28, 0x2a2e26, 0.62).setOrigin(0, 0);
    this.census.add(headBand);
    this.censusMarks.push(headBand);
    let x = 18;
    for (const column of this.columns()) {
      const sortable = ["repo", "stars", "issues", "prs", "band", "district"].includes(column.key);
      const header = ink(this, x, headerY, `${column.label}${this.censusSort.key === column.key ? (this.censusSort.descending ? " ↓" : " ↑") : ""}`, {
        fontSize: `${head}px`,
        color: sortable ? GOLD : MUTED,
      });
      if (sortable) {
        header.setInteractive({ useHandCursor: true });
        header.on("pointerup", () => this.sortBy(column.key as CensusSortKey));
      }
      this.census.add(header);
      this.censusHeader.push(header);
      x += column.width;
    }
    const slice = rows.slice(this.censusScroll, this.censusScroll + visibleRows);
    slice.forEach((row, i) => {
      const y = headerY + 28 + i * rowH;
      const selected = row.repo === this.selected?.lot.fullName;
      const band = this.add
        .rectangle(12, y - 6, width - 24, rowH - 2, selected ? 0x5c5330 : i % 2 ? 0x3a3e34 : 0x2f332c, selected ? 0.52 : 0.42)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      band.on("pointerup", () => this.actions.select(row.repo, true));
      this.census.add(band);
      this.censusMarks.push(band);
      let cx = 18;
      const inkColor = selected ? GOLD : INK;
      for (const column of this.columns()) {
        const label = ink(this, cx, y, this.clipCell(String(cellValue(row, column.key)), column.width, font), {
          fontSize: `${font}px`,
          color: inkColor,
        });
        this.census.add(label);
        this.censusRowsTexts.push(label);
        cx += column.width;
      }
    });
    if (rows.length > visibleRows) {
      const more = ink(this, width - 16, H - 18, `${this.censusScroll + slice.length}/${rows.length}`, {
        fontSize: "12px",
        color: MUTED,
      }).setOrigin(1, 1);
      this.census.add(more);
      this.censusHeader.push(more);
    }
    this.emit("census-rows", rows);
  }

  /** Keyboard browsing of the census: returns the row that would be inspected. */
  censusStep(delta: number): CensusRow | undefined {
    if (!this.censusOpen) return undefined;
    const index = Math.max(0, Math.min(this.censusVisible.length - 1, this.censusVisible.findIndex((r) => r.repo === this.selected?.lot.fullName) + delta));
    const row = this.censusVisible[index];
    if (!row) return undefined;
    const { rowH, headerY } = this.censusMetrics(),
      H = Math.max(160, this.census.height || Math.min(this.scale.height * 0.5, 420)),
      visibleRows = Math.max(1, Math.floor((H - headerY - 28) / rowH));
    if (index < this.censusScroll) this.censusScroll = index;
    if (index >= this.censusScroll + visibleRows) this.censusScroll = index - visibleRows + 1;
    this.renderCensus();
    return row;
  }

  toast(message: string): void {
    this.toastText.setText(message).setVisible(true);
    this.toastBg.setVisible(true).setDisplaySize(Math.max(360, this.toastText.width + 36), 48);
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(3200, () => {
      this.toastText.setVisible(false);
      this.toastBg.setVisible(false);
    });
    this.emit("toast", message);
  }

  showTag(repo: string, x: number, y: number): void {
    this.tag.setText(repo).setVisible(true);
    const tx = Math.min(this.scale.width - this.tag.width - 16, Math.max(8, x + 15));
    const ty = Math.max(8, y - 35);
    this.tag.setPosition(tx, ty);
    this.tagPlate.setVisible(true).setPosition(tx - 8, ty - 5).setDisplaySize(this.tag.width + 16, 24);
  }
  hideTag(): void {
    this.tag.setVisible(false);
    this.tagPlate.setVisible(false);
  }

  /** True when the pointer is over a HUD element (so the city ignores the gesture). */
  /**
   * Screen rectangle of a named HUD control, or null when it is not currently
   * shown. Buttons nested in the d-pad, card and census containers are included
   * so browser tests and the accessibility mirror can target the same element.
   */
  labelText(name: string): string | null {
    return this.buttons.get(name)?.label.text ?? null;
  }

  locate(name: string): { x: number; y: number; width: number; height: number } | null {
    const object = this.buttons.get(name)?.container ?? (this.children.getByName(name) as Phaser.GameObjects.Container | null);
    if (!object) return null;
    for (let node: Phaser.GameObjects.GameObject | null = object; node; node = (node as Phaser.GameObjects.Container).parentContainer ?? null) {
      if (!(node as Phaser.GameObjects.Container).visible) return null;
    }
    const f = frameOf(object);
    if (f.width <= 0 || f.height <= 0) return null;
    return { x: f.x + f.width / 2, y: f.y + f.height / 2, width: f.width, height: f.height };
  }

  consumes(x: number, y: number): boolean {
    const hits: Phaser.GameObjects.Container[] = [this.plate, this.tools, this.compass, this.massContainer, this.minimap, this.dpad];
    for (const name of ["zoom-in", "zoom-out", "census", "capture", "svg", "motion", "follow"]) hits.push(this.buttons.get(name)!.container);
    if (this.card.visible) hits.push(this.card);
    if (this.censusOpen) hits.push(this.census);
    return hits.some((c) => c.visible && contains(frameOf(c), x, y));
  }
}

function contains(frame: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
}

function cellValue(row: CensusRow, key: string): string | number {
  switch (key) {
    case "repo":
      return row.repo + (row.constructing ? " *" : "") + (row.partial ? " ~" : "");
    case "band":
      return row.band;
    default:
      return (row as unknown as Record<string, string | number>)[key];
  }
}

function ageLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
