import type { CityLot } from "../../src/types.js";
import { yardLabel, yardPropList } from "../../src/rules/cityFiles.js";

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export class Hud {
  private tag = document.getElementById("hover-tag");
  private card = document.getElementById("lot-card");
  private hoverRepo: string | null = null;

  hideTag(): void {
    this.hoverRepo = null;
    if (this.tag) {
      this.tag.hidden = true;
      this.tag.innerHTML = "";
    }
  }

  showTag(lot: CityLot, clientX: number, clientY: number): void {
    const tag = this.tag;
    const stage = document.getElementById("stage");
    if (!tag || !stage) return;
    if (this.hoverRepo !== lot.fullName) {
      this.hoverRepo = lot.fullName;
      const id = String(lot.buildingId).padStart(2, "0");
      tag.innerHTML =
        `<div class="tag-pop">` +
        `<div class="tag-name">${esc(lot.fullName)}</div>` +
        `<div class="tag-sub">${esc(lot.buildingBand)}${id} · ${esc(yardLabel(lot.yard))}</div>` +
        `</div>`;
      tag.hidden = false;
    }
    const box = stage.getBoundingClientRect();
    const left = Math.min(Math.max(clientX - box.left + 18, 12), box.width - tag.offsetWidth - 12);
    const top = Math.min(
      Math.max(clientY - box.top - tag.offsetHeight / 2, 12),
      box.height - tag.offsetHeight - 12,
    );
    tag.style.left = `${left}px`;
    tag.style.top = `${top}px`;
  }

  hideCard(): void {
    if (!this.card) return;
    this.card.hidden = true;
    this.card.innerHTML = "";
  }

  showCard(lot: CityLot): void {
    if (!this.card) return;
    const props = yardPropList(lot);
    const id = String(lot.buildingId).padStart(2, "0");
    this.card.innerHTML =
      `<button class="close" aria-label="Close">×</button>` +
      `<h3><a href="${esc(lot.url)}" target="_blank" rel="noreferrer">${esc(lot.fullName)}</a></h3>` +
      `<p>${lot.stars.toLocaleString()} stars · ${lot.openIssues} issues · ${lot.openPrs} PRs</p>` +
      `<p>Building ${esc(lot.buildingBand)}${id} · loading zone: ${esc(yardLabel(lot.yard))}</p>` +
      `<p>Pad rules: stars → band, hash → catalog id ${id}</p>` +
      `<p>Zone props: ${esc(props.join(", ") || "—")}</p>`;
    this.card.hidden = false;
    this.card.querySelector(".close")?.addEventListener("click", () => this.hideCard());
  }
}
