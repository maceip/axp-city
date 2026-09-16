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
import { yardLabel, yardPropList } from "../../src/rules/cityFiles.js";
import type { LotPlacement } from "../../src/world/layout.js";
import { SceneKeys } from "./Boot.js";
import type { ConnectionState } from "./connection.js";

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

const FONT = "ui-monospace, Menlo, Consolas, monospace";
const GOLD = "#f6dd91";
const INK = "#f2efe2";
const MUTED = "#b9c4b3";
const PLATE = 0x152520;
const PLATE_ALPHA = 0.9;

interface Button {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
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
  private district!: Phaser.GameObjects.Text;
  private coords!: Phaser.GameObjects.Text;
  private statusDot!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private freshText!: Phaser.GameObjects.Text;
  private countText!: Phaser.GameObjects.Text;
  private compass!: Phaser.GameObjects.Container;
  private massBar!: Phaser.GameObjects.Graphics;
  private massLabel!: Phaser.GameObjects.Text;
  private massContainer!: Phaser.GameObjects.Container;
  private zoomText!: Phaser.GameObjects.Text;
  private minimap!: Phaser.GameObjects.Container;
  private minimapPlan!: Phaser.GameObjects.Graphics;
  private minimapView!: Phaser.GameObjects.Graphics;
  private minimapBounds = { x: 0, y: 0, width: 1, height: 1 };
  private minimapSize = { w: 180, h: 118 };
  private card!: Phaser.GameObjects.Container;
  private cardBg!: Phaser.GameObjects.Graphics;
  private cardTexts: Phaser.GameObjects.Text[] = [];
  private census!: Phaser.GameObjects.Container;
  private censusBg!: Phaser.GameObjects.Graphics;
  private censusRowsTexts: Phaser.GameObjects.Text[] = [];
  private censusHeader: Phaser.GameObjects.Text[] = [];
  private censusOpen = false;
  private censusScroll = 0;
  private censusSort: { key: CensusSortKey; descending: boolean } = { key: "stars", descending: true };
  private censusFilter = "";
  private censusVisible: CensusRow[] = [];
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer?: Phaser.Time.TimerEvent;
  private tag!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private dpad!: Phaser.GameObjects.Container;
  private tools!: Phaser.GameObjects.Container;
  private listeners = new Set<(event: string, detail?: unknown) => void>();
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

  create(): void {
    this.cameras.main.setRoundPixels(true);
    this.plate = this.add.container(16, 16);
    const plateBg = this.add.graphics();
    plateBg.fillStyle(PLATE, PLATE_ALPHA).fillRoundedRect(0, 0, 250, 78, 8);
    plateBg.lineStyle(2, 0xf6dd91, 0.55).strokeRoundedRect(0, 0, 250, 78, 8);
    const title = this.add.text(14, 10, "AXP CITY", { fontFamily: FONT, fontSize: "12px", color: GOLD, letterSpacing: 2 });
    this.district = this.add.text(14, 28, "Central Park", { fontFamily: FONT, fontSize: "19px", color: INK, fontStyle: "bold" });
    this.coords = this.add.text(14, 55, "0 · 0", { fontFamily: FONT, fontSize: "11px", color: MUTED });
    this.plate.add([plateBg, title, this.district, this.coords]);
    this.plate.setSize(250, 78).setName("plate");

    // Connection and freshness are separate readings.
    const status = this.add.container(0, 16);
    status.setSize(320, 62);
    const statusBg = this.add.graphics();
    statusBg.fillStyle(PLATE, PLATE_ALPHA).fillRoundedRect(0, 0, 320, 62, 8);
    this.statusDot = this.add.graphics();
    this.statusText = this.add.text(30, 10, "Connecting", { fontFamily: FONT, fontSize: "13px", color: INK });
    this.freshText = this.add.text(14, 30, "GitHub data: —", { fontFamily: FONT, fontSize: "11px", color: MUTED });
    this.countText = this.add.text(14, 45, "", { fontFamily: FONT, fontSize: "11px", color: MUTED });
    status.add([statusBg, this.statusDot, this.statusText, this.freshText, this.countText]);
    status.setName("status");
    this.tools = status;

    this.compass = this.add.container(0, 92);
    const ring = this.add.graphics();
    ring.fillStyle(PLATE, PLATE_ALPHA).fillCircle(26, 26, 26);
    ring.lineStyle(2, 0xf6dd91, 0.6).strokeCircle(26, 26, 26);
    // Isometric north points up-right on screen: the needle shows that.
    ring.fillStyle(0xf6dd91, 1).fillTriangle(26, 26, 38, 10, 30, 22);
    ring.fillStyle(0xd9e4ee, 0.55).fillTriangle(26, 26, 14, 42, 22, 30);
    const n = this.add.text(38, 2, "N", { fontFamily: FONT, fontSize: "10px", color: GOLD, fontStyle: "bold" });
    const w = this.add.text(6, 24, "W", { fontFamily: FONT, fontSize: "9px", color: MUTED });
    const e = this.add.text(40, 24, "E", { fontFamily: FONT, fontSize: "9px", color: MUTED });
    const s = this.add.text(12, 42, "S", { fontFamily: FONT, fontSize: "9px", color: MUTED });
    this.compass.add([ring, n, w, e, s]);
    // Circle centre is offset by the display origin like plateHit() rectangles.
    this.compass.setSize(52, 52).setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Circle(52, 52, 26), hitAreaCallback: Phaser.Geom.Circle.Contains });
    this.compass.on("pointerup", () => this.actions.home());
    this.compass.setName("compass");

    this.massContainer = this.add.container(0, 92);
    const massBg = this.add.graphics();
    massBg.fillStyle(PLATE, PLATE_ALPHA).fillRoundedRect(0, 0, 186, 44, 8);
    this.massLabel = this.add.text(12, 8, "MASS —", { fontFamily: FONT, fontSize: "10px", color: GOLD, letterSpacing: 1 });
    this.massBar = this.add.graphics();
    this.massContainer.add([massBg, this.massLabel, this.massBar]);
    this.massContainer.setSize(186, 44).setName("mass");
    this.drawMass(undefined);

    this.zoomText = this.add.text(0, 0, "100%", { fontFamily: FONT, fontSize: "12px", color: INK }).setOrigin(0.5);
    this.button("zoom-out", "−", 40, 40, () => this.actions.zoom(1 / 1.2));
    this.button("zoom-in", "+", 40, 40, () => this.actions.zoom(1.2));

    this.minimap = this.add.container(0, 0);
    const mapBg = this.add.graphics();
    mapBg.fillStyle(PLATE, PLATE_ALPHA).fillRoundedRect(-6, -6, this.minimapSize.w + 12, this.minimapSize.h + 30, 8);
    this.minimapPlan = this.add.graphics();
    this.minimapView = this.add.graphics();
    const mapLabel = this.add.text(this.minimapSize.w / 2, this.minimapSize.h + 8, "CITY OVERVIEW · drag to travel", { fontFamily: FONT, fontSize: "9px", color: MUTED, letterSpacing: 1 }).setOrigin(0.5, 0);
    this.minimap.add([mapBg, this.minimapPlan, this.minimapView, mapLabel]);
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
    const pad = this.add.graphics();
    pad.fillStyle(PLATE, PLATE_ALPHA).fillRoundedRect(0, 0, 150, 150, 12);
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

    this.hint = this.add
      .text(0, 0, "Drag to explore · scroll or pinch to zoom · WASD/arrows · / search · C census · F follow · Esc clear", {
        fontFamily: FONT,
        fontSize: "11px",
        color: MUTED,
        backgroundColor: "rgba(21,37,32,0.85)",
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5, 1);
    this.button("census", "Census", 92, 36, () => this.toggleCensus());
    this.button("capture", "Capture PNG", 120, 36, () => this.actions.capture());
    this.button("svg", "SVG", 56, 36, () => window.open(document.querySelector<HTMLMetaElement>('meta[name="city-svg"]')?.content || "/api/city/export.svg", "_blank", "noopener"));
    this.button("motion", "Motion: on", 116, 36, () => {
      this.motion = this.actions.toggleMotion();
      this.buttons.get("motion")!.label.setText(this.motion ? "Motion: on" : "Motion: off");
      this.emit("motion", this.motion);
    });
    this.button("follow", "Follow", 78, 36, () => this.actions.follow());

    this.card = this.add.container(0, 0).setVisible(false).setName("card");
    this.cardBg = this.add.graphics();
    this.card.add(this.cardBg);
    const close = this.button("close-card", "×", 32, 32, () => this.actions.select(undefined));
    this.card.add(close.container);
    const open = this.button("open-repo", "View repository ↗", 170, 34, () => {
      if (this.selected) window.open(this.selected.lot.url, "_blank", "noopener,noreferrer");
    });
    this.card.add(open.container);

    this.census = this.add.container(0, 0).setVisible(false).setName("census-panel");
    this.censusBg = this.add.graphics();
    this.census.add(this.censusBg);
    const closeCensus = this.button("close-census", "×", 32, 32, () => this.toggleCensus(false));
    this.census.add(closeCensus.container);

    this.toastText = this.add
      .text(0, 0, "", { fontFamily: FONT, fontSize: "13px", color: INK, backgroundColor: "rgba(21,37,32,0.94)", padding: { x: 14, y: 8 } })
      .setOrigin(0.5, 1)
      .setVisible(false)
      .setDepth(50);
    this.tag = this.add
      .text(0, 0, "", { fontFamily: FONT, fontSize: "12px", color: INK, backgroundColor: "rgba(21,37,32,0.94)", padding: { x: 8, y: 4 } })
      .setVisible(false)
      .setDepth(60);

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

  private button(name: string, text: string, width: number, height: number, onClick: () => void): Button {
    const container = this.add.container(0, 0);
    const bg = this.add.graphics();
    const label = this.add.text(width / 2, height / 2, text, { fontFamily: FONT, fontSize: height >= 40 ? "20px" : "12px", color: INK }).setOrigin(0.5);
    const paint = (hover: boolean) => {
      bg.clear();
      bg.fillStyle(hover ? 0x2b4a40 : PLATE, PLATE_ALPHA).fillRoundedRect(0, 0, width, height, 8);
      bg.lineStyle(1.5, 0xf6dd91, hover ? 0.9 : 0.5).strokeRoundedRect(0, 0, width, height, 8);
    };
    paint(false);
    container.add([bg, label]);
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
    this.tools.setPosition(W - 336, 16);
    this.compass.setPosition(W - 68, 92);
    this.massContainer.setPosition(W - 336, 92);
    this.massContainer.setVisible(!small || !this.card.visible);
    const mapW = small ? 120 : 180,
      mapH = small ? 78 : 118;
    if (mapW !== this.minimapSize.w) {
      this.minimapSize = { w: mapW, h: mapH };
      (this.minimap.list[0] as Phaser.GameObjects.Graphics).clear().fillStyle(PLATE, PLATE_ALPHA).fillRoundedRect(-6, -6, mapW + 12, mapH + 30, 8);
      (this.minimap.list[3] as Phaser.GameObjects.Text).setPosition(mapW / 2, mapH + 8);
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
    let x = small ? 16 : 190;
    const y = small ? H - 216 : H - 52;
    this.hint.setOrigin(0, 1).setPosition(190, H - 60).setVisible(!small && !this.censusOpen && W >= 1100);
    for (const name of toolbar) {
      const b = this.buttons.get(name)!;
      b.container.setPosition(x, y);
      x += b.width + 8;
    }
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
    this.freshText.setColor(freshColour);
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
    g.fillStyle(0xa8bc8d, 1).fillRect(0, 0, w, h);
    for (const f of plan.features) {
      g.fillStyle(f.kind === "river" ? 0x6bacae : f.kind === "park" ? 0x759959 : f.kind === "plaza" ? 0xc4b69a : 0x768270, 1);
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
      const t = this.add.text(16, y, text, { fontFamily: FONT, fontSize: size ?? "12px", color, wordWrap: { width: width - 32 } });
      this.card.add(t);
      this.cardTexts.push(t);
      y += t.height + 6;
    }
    this.card.setData("height", y + 52);
    this.card.setVisible(true);
    this.layoutCard();
    this.emit("selection", { place, lines: lines.map((l) => l[0]) });
  }

  private cardWidth(): number {
    return this.scale.width < 700 ? this.scale.width - 24 : 330;
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
    this.cardBg.clear();
    this.cardBg.fillStyle(PLATE, 0.95).fillRoundedRect(0, 0, width, height, 10);
    this.cardBg.lineStyle(2, 0xf6dd91, 0.7).strokeRoundedRect(0, 0, width, height, 10);
    this.buttons.get("close-card")!.container.setPosition(width - 40, 8);
    this.buttons.get("open-repo")!.container.setPosition(16, height - 44);
    if (small) {
      this.dpad.setVisible(false);
      this.hint.setVisible(false);
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
    if (open) this.renderCensus();
    this.layout();
    this.emit("census", open);
  }
  get censusIsOpen(): boolean {
    return this.censusOpen;
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
    const height = Math.min(H * 0.5, 420);
    this.census.setPosition(0, H - height).setSize(W, height);
    this.censusBg.clear();
    this.censusBg.fillStyle(PLATE, 0.96).fillRect(0, 0, W, height);
    this.censusBg.lineStyle(3, 0xf6dd91, 0.8).lineBetween(0, 0, W, 0);
    this.buttons.get("close-census")!.container.setPosition(W - 44, 8);
    this.census.setDepth(45);
    this.renderCensus();
  }

  columns(): Array<{ key: CensusSortKey | "crew" | "yard" | "props"; label: string; width: number }> {
    const small = this.scale.width < 700;
    return small
      ? [
          { key: "repo", label: "Repo", width: 170 },
          { key: "stars", label: "Stars", width: 60 },
          { key: "prs", label: "PRs", width: 40 },
          { key: "band", label: "Bld", width: 40 },
          { key: "crew", label: "Crew", width: 90 },
        ]
      : [
          { key: "repo", label: "Repo", width: 250 },
          { key: "district", label: "District", width: 110 },
          { key: "stars", label: "Stars", width: 70 },
          { key: "issues", label: "Issues", width: 60 },
          { key: "prs", label: "PRs", width: 50 },
          { key: "band", label: "Bld", width: 40 },
          { key: "crew", label: "Crew", width: 120 },
          { key: "yard", label: "Yard", width: 130 },
          { key: "props", label: "Loading zone", width: 260 },
        ];
  }

  private renderCensus(): void {
    for (const t of [...this.censusRowsTexts, ...this.censusHeader]) t.destroy();
    this.censusRowsTexts = [];
    this.censusHeader = [];
    const rows = sortCensus(filterCensus(censusRows(this.snapshot.plan, this.now()), this.censusFilter), this.censusSort.key, this.censusSort.descending);
    this.censusVisible = rows;
    const H = Math.min(this.scale.height * 0.5, 420);
    const rowH = 22;
    const visibleRows = Math.max(1, Math.floor((H - 70) / rowH));
    this.censusScroll = Math.min(this.censusScroll, Math.max(0, rows.length - visibleRows));
    const title = this.add.text(16, 10, `LOT CENSUS · ${rows.length} of ${this.snapshot.plan.placements.length} repositories${this.censusFilter ? ` matching “${this.censusFilter}”` : ""} · sorted by ${this.censusSort.key} ${this.censusSort.descending ? "↓" : "↑"} · scroll or ↑↓ to browse, Enter to inspect`, {
      fontFamily: FONT,
      fontSize: "11px",
      color: GOLD,
      letterSpacing: 1,
    });
    this.census.add(title);
    this.censusHeader.push(title);
    let x = 16;
    for (const column of this.columns()) {
      const sortable = ["repo", "stars", "issues", "prs", "band", "district"].includes(column.key);
      const header = this.add.text(x, 34, `${column.label}${this.censusSort.key === column.key ? (this.censusSort.descending ? " ↓" : " ↑") : ""}`, { fontFamily: FONT, fontSize: "11px", color: sortable ? INK : MUTED, fontStyle: "bold" });
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
      const y = 58 + i * rowH;
      const selected = row.repo === this.selected?.lot.fullName;
      let cx = 16;
      const line = this.add.text(0, y, "", { fontFamily: FONT, fontSize: "11px", color: selected ? GOLD : INK });
      let text = "";
      for (const column of this.columns()) {
        const value = String(cellValue(row, column.key));
        const chars = Math.max(3, Math.floor(column.width / 7.2) - 1);
        text += (value.length > chars ? `${value.slice(0, chars - 1)}…` : value).padEnd(chars + 1);
        cx += column.width;
      }
      line.setText(text.trimEnd());
      line.setInteractive({ useHandCursor: true });
      line.on("pointerover", () => line.setColor("#ffffff"));
      line.on("pointerout", () => line.setColor(selected ? GOLD : INK));
      line.on("pointerup", () => this.actions.select(row.repo, true));
      this.census.add(line);
      this.censusRowsTexts.push(line);
      void cx;
    });
    if (rows.length > visibleRows) {
      const more = this.add.text(this.scale.width - 60, H - 18, `${this.censusScroll + slice.length}/${rows.length}`, { fontFamily: FONT, fontSize: "10px", color: MUTED }).setOrigin(1, 1);
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
    const rowH = 22,
      H = Math.min(this.scale.height * 0.5, 420),
      visibleRows = Math.max(1, Math.floor((H - 70) / rowH));
    if (index < this.censusScroll) this.censusScroll = index;
    if (index >= this.censusScroll + visibleRows) this.censusScroll = index - visibleRows + 1;
    this.renderCensus();
    return row;
  }

  toast(message: string): void {
    this.toastText.setText(message).setVisible(true);
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(3200, () => this.toastText.setVisible(false));
    this.emit("toast", message);
  }

  showTag(repo: string, x: number, y: number): void {
    this.tag.setText(repo).setVisible(true);
    this.tag.setPosition(Math.min(this.scale.width - this.tag.width - 8, Math.max(8, x + 15)), Math.max(8, y - 35));
  }
  hideTag(): void {
    this.tag.setVisible(false);
  }

  /** True when the pointer is over a HUD element (so the city ignores the gesture). */
  /**
   * Screen rectangle of a named HUD control, or null when it is not currently
   * shown. Buttons nested in the d-pad, card and census containers are included
   * so browser tests and the accessibility mirror can target the same element.
   */
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
      return row.repo + (row.constructing ? " 🏗" : "") + (row.partial ? " ~" : "");
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
