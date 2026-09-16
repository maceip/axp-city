import type { CensusRow } from "../../src/game/census.js";
import type { CitySnapshot } from "../../src/live/protocol.js";
import type { LotPlacement } from "../../src/world/layout.js";
import type { HudScene } from "./HudScene.js";

/**
 * Screen-reader and keyboard mirror of the Phaser HUD. Nothing here draws the
 * city: it exposes the same status, selection and census the canvas shows as
 * real DOM text and focusable buttons, and forwards activation back to the
 * scene. The repository search field is a native input for the same reason.
 */
export class AccessibilityMirror {
  private root = document.getElementById("a11y")!;
  private status = this.root.querySelector<HTMLElement>("#a11y-status")!;
  private selection = this.root.querySelector<HTMLElement>("#a11y-selection")!;
  private list = this.root.querySelector<HTMLElement>("#a11y-repos")!;
  private known = "";
  private unsubscribe: () => void;

  constructor(
    hud: HudScene,
    private readonly select: (repo: string) => void,
  ) {
    this.unsubscribe = hud.on((event, detail) => {
      if (event === "status") {
        const d = detail as { connection: string; freshness: string };
        this.status.textContent = `${d.connection}. ${d.freshness}.`;
      } else if (event === "selection") {
        const d = detail as { place: LotPlacement; lines: string[] } | undefined;
        this.selection.textContent = d ? `Selected ${d.place.lot.fullName}. ${d.lines.join(". ")}.` : "No repository selected.";
      } else if (event === "snapshot") this.rebuild(detail as CitySnapshot);
      else if (event === "toast") this.announce(detail as string);
      else if (event === "census-rows") this.describeRows(detail as CensusRow[]);
    });
  }

  announce(message: string): void {
    const live = this.root.querySelector<HTMLElement>("#a11y-live")!;
    live.textContent = "";
    requestAnimationFrame(() => {
      live.textContent = message;
    });
  }

  /** The list only changes when the set of repositories changes, not on every refresh. */
  private rebuild(snapshot: CitySnapshot): void {
    const names = snapshot.plan.placements.map((p) => p.lot.fullName).join("\n");
    if (names === this.known) return;
    this.known = names;
    this.list.replaceChildren();
    for (const place of snapshot.plan.placements) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.repo = place.lot.fullName;
      button.textContent = `${place.lot.fullName} — ${place.district}, ${place.lot.buildingBand} building, ${place.lot.stars.toLocaleString()} stars`;
      button.onclick = () => this.select(place.lot.fullName);
      li.append(button);
      this.list.append(li);
    }
  }

  private describeRows(rows: CensusRow[]): void {
    const table = this.root.querySelector<HTMLElement>("#a11y-census")!;
    table.replaceChildren();
    const caption = document.createElement("caption");
    caption.textContent = `Lot census, ${rows.length} rows`;
    const head = document.createElement("tr");
    for (const label of ["Repository", "District", "Stars", "Issues", "PRs", "Building", "Crew", "Yard", "Loading zone"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      head.append(th);
    }
    table.append(caption, head);
    for (const row of rows.slice(0, 400)) {
      const tr = document.createElement("tr");
      for (const value of [row.repo, row.district, row.stars, row.issues, row.prs, row.band, `${row.crew} (${row.crewBasis})`, row.yard, row.props]) {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.append(td);
      }
      tr.onclick = () => this.select(row.repo);
      table.append(tr);
    }
  }

  destroy(): void {
    this.unsubscribe();
  }
}
