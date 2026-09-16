import type { CitySnapshot } from "../../src/live/protocol.js";
import type { LotPlacement } from "../../src/world/layout.js";
import { CONSTRUCTION_MS } from "../../src/world/constants.js";
import { project } from "../../src/render/iso.js";
import { yardPropList } from "../../src/rules/cityFiles.js";
import type { Rect } from "../../src/game/visibility.js";
function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export interface HudActions {
  zoom(factor: number): void;
  home(): void;
  focus(repo: string): void;
  move(x: number, y: number): void;
  jump(x: number, y: number): void;
  weather(): string;
}
export class Hud {
  private selected?: string;
  private clockOffset = 0;
  private data!: CitySnapshot;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private mapBounds = { x: 0, y: 0, width: 1, height: 1 };
  private readonly map = document.querySelector<HTMLCanvasElement>("#minimap")!;
  constructor(actions: HudActions) {
    document.getElementById("zoom-in")!.onclick = () => actions.zoom(1.2);
    document.getElementById("zoom-out")!.onclick = () => actions.zoom(1 / 1.2);
    document.getElementById("home")!.onclick = () => actions.home();
    document.getElementById("weather")!.onclick = () => {
      document.getElementById("weather")!.textContent =
        `Sky: ${actions.weather()}`;
    };
    const input = document.querySelector<HTMLInputElement>("#repo-search")!;
    input.onchange = () => {
      actions.focus(input.value);
      input.blur();
    };
    const directions: Record<string, [number, number]> = {
      up: [0, -1],
      down: [0, 1],
      left: [-1, 0],
      right: [1, 0],
    };
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-move]",
    )) {
      button.onpointerdown = (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        actions.move(...directions[button.dataset.move!]);
      };
      button.onpointerup = button.onpointercancel = () => actions.move(0, 0);
      button.onlostpointercapture = () => actions.move(0, 0);
    }
    this.map.onclick = (event) => {
      const r = this.map.getBoundingClientRect();
      actions.jump(
        this.mapBounds.x +
          ((event.clientX - r.left) / r.width) * this.mapBounds.width,
        this.mapBounds.y +
          ((event.clientY - r.top) / r.height) * this.mapBounds.height,
      );
    };
  }
  update(data: CitySnapshot): void {
    this.data = data;
    this.clockOffset = Date.parse(data.serverTime) - Date.now();
    document.getElementById("city-count")!.textContent =
      `${data.plan.placements.length.toLocaleString()} repos`;
    const list = document.getElementById("repo-options")!;
    list.replaceChildren();
    for (const p of data.plan.placements) {
      const o = document.createElement("option");
      o.value = p.lot.fullName;
      list.append(o);
    }
    if (this.selected) {
      const p = data.plan.placements.find(
        (p) => p.lot.fullName === this.selected,
      );
      if (p) this.showCard(p);
    }
    this.status("Connected");
  }
  status(status: string): void {
    const connected = status === "Connected";
    document.getElementById("connection-status")!.textContent = connected
      ? this.data?.mode === "offline"
        ? "Offline demo"
        : "Live city"
      : status;
    document
      .getElementById("connection-dot")!
      .classList.toggle("live", connected && this.data?.mode !== "offline");
  }
  showCard(place: LotPlacement): void {
    this.selected = place.lot.fullName;
    const lot = place.lot,
      card = document.getElementById("lot-card")!;
    const constructing =
      place.addedAt &&
      Date.now() + this.clockOffset - Date.parse(place.addedAt) <
        CONSTRUCTION_MS;
    card.dataset.repo = lot.fullName;
    card.innerHTML = `<button class="close" aria-label="Close details">×</button><span class="eyebrow">${esc(place.district.toUpperCase())} · ${lot.buildingBand} BUILDING</span><h2>${esc(lot.name)}</h2><p class="owner">${esc(lot.owner)} / ${esc(lot.name)}</p><div class="stats"><div><span>STARS</span><b>${lot.stars.toLocaleString()}</b></div><div><span>ISSUES</span><b>${lot.openIssues}</b></div><div><span>OPEN PRS</span><b>${lot.openPrs}</b></div></div><div class="state">${constructing ? "UNDER CONSTRUCTION" : esc(lot.yard.replaceAll("_", " ").toUpperCase())}<br>${lot.occupantClass === "robot" ? "ROBOT CREW" : lot.occupantClass === "human" ? "HUMAN CREW" : "QUIET LOT"}</div><p class="props">Loading zone: ${esc(yardPropList(lot).join(", ") || "ready for its next delivery")}.</p><p class="source">${lot.dataSource === "fixture" ? "Recorded snapshot" : "GitHub data"}${lot.fetchedAt ? ` · ${esc(new Date(lot.fetchedAt).toLocaleString())}` : ""}<br>${lot.rulesSource === "repository" ? "Repository rules" : "City defaults"}${lot.rulesWarning ? ` · ${esc(lot.rulesWarning)}` : ""}</p><a class="repo-link" href="https://github.com/${esc(lot.fullName)}" target="_blank" rel="noopener noreferrer">View repository ↗</a>`;
    card.hidden = false;
    card.querySelector<HTMLButtonElement>(".close")!.onclick = () =>
      this.hideCard();
  }
  hideCard(): void {
    this.selected = undefined;
    document.getElementById("lot-card")!.hidden = true;
  }
  showTag(repo: string, x: number, y: number): void {
    const tag = document.getElementById("hover-tag")!;
    tag.textContent = repo;
    tag.hidden = false;
    tag.style.left = `${Math.min(innerWidth - 260, Math.max(8, x + 15))}px`;
    tag.style.top = `${Math.max(8, y - 35)}px`;
  }
  hideTag(): void {
    document.getElementById("hover-tag")!.hidden = true;
  }
  toast(message: string): void {
    const el = document.getElementById("toast")!;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3200);
  }
  camera(
    view: Rect,
    zoom: number,
    district: string,
    x: number,
    y: number,
  ): void {
    document.getElementById("zoom-level")!.textContent =
      `${Math.round(zoom * 100)}%`;
    document.getElementById("district-name")!.textContent = district;
    document.getElementById("coordinates")!.textContent =
      `${Math.round(x)} · ${Math.round(y)}`;
    if (!this.data) return;
    const plan = this.data.plan,
      b = plan.bounds;
    const corners = [
      project(b.minX, b.minY),
      project(b.maxX, b.minY),
      project(b.minX, b.maxY),
      project(b.maxX, b.maxY),
    ];
    const xs = corners.map((p) => p.sx),
      ys = corners.map((p) => p.sy);
    const minX = Math.min(...xs) - 80,
      minY = Math.min(...ys) - 100,
      maxX = Math.max(...xs) + 80,
      maxY = Math.max(...ys) + 80;
    this.mapBounds = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
    const ctx = this.map.getContext("2d")!,
      w = this.map.width,
      h = this.map.height;
    const px = (x: number) => ((x - minX) / (maxX - minX)) * w,
      py = (y: number) => ((y - minY) / (maxY - minY)) * h;
    ctx.fillStyle = "#a8bc8d";
    ctx.fillRect(0, 0, w, h);
    for (const f of plan.features) {
      ctx.fillStyle =
        f.kind === "river"
          ? "#6bacae"
          : f.kind === "park"
            ? "#759959"
            : "#768270";
      ctx.beginPath();
      [
        project(f.x, f.y),
        project(f.x + f.w, f.y),
        project(f.x + f.w, f.y + f.h),
        project(f.x, f.y + f.h),
      ].forEach((p, i) => {
        if (i) ctx.lineTo(px(p.sx), py(p.sy));
        else ctx.moveTo(px(p.sx), py(p.sy));
      });
      ctx.fill();
    }
    for (const p of plan.placements) {
      const a = project(p.x + 1, p.y + 1);
      ctx.fillStyle = p.lot.fullName === this.selected ? "#fff6cd" : "#455e47";
      ctx.fillRect(px(a.sx) - 1, py(a.sy) - 1, 3, 3);
    }
    ctx.strokeStyle = "#f9f1cb";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      px(view.x),
      py(view.y),
      (view.width / (maxX - minX)) * w,
      (view.height / (maxY - minY)) * h,
    );
  }
}
