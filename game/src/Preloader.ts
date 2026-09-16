import Phaser from "phaser";
import snapshot from "../../fixtures/github/batch.json";
import { planCityScene, requiredSheets } from "../../src/game/plan.js";
import { parseCity } from "../../src/parser/index.js";
import { ANIM_SHEETS } from "../../src/render/sprites.js";
import type { CityLot, IngestSnapshot } from "../../src/types.js";
import { SceneKeys } from "./Boot.js";
import { SPRITE_BASE } from "./stamps.js";

function isLots(value: unknown): value is CityLot[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0]?.fullName === "string";
}

async function loadLots(): Promise<{ lots: CityLot[]; generatedAt: string; source: string }> {
  try {
    const res = await fetch("/lots.json");
    if (res.ok) {
      const data: unknown = await res.json();
      if (isLots(data)) {
        return { lots: data, generatedAt: new Date().toISOString(), source: "out/lots.json" };
      }
    }
  } catch {
    /* fall through to fixtures */
  }
  const batch = snapshot as unknown as IngestSnapshot;
  return {
    lots: parseCity(batch.metrics, { now: batch.asOf }),
    generatedAt: batch.asOf,
    source: "fixtures/github/batch.json",
  };
}

export class Preloader extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Preloader);
  }

  preload(): void {
    const bar = document.querySelector("#boot-bar span") as HTMLElement | null;
    this.load.on("progress", (value: number) => {
      if (bar) bar.style.width = `${Math.round(value * 100)}%`;
    });

    const animFiles = new Set(Object.values(ANIM_SHEETS).map((sheet) => sheet.file));
    for (const file of requiredSheets()) {
      if (animFiles.has(file)) continue;
      this.load.image(file, `${SPRITE_BASE}/${file}`);
    }
    for (const [name, sheet] of Object.entries(ANIM_SHEETS)) {
      this.load.spritesheet(name, `${SPRITE_BASE}/${sheet.file}`, {
        frameWidth: sheet.width / sheet.cols,
        frameHeight: sheet.height / sheet.rows,
      });
    }
  }

  async create(): Promise<void> {
    for (const [name, sheet] of Object.entries(ANIM_SHEETS)) {
      if (this.anims.exists(name)) continue;
      this.anims.create({
        key: name,
        frames: this.anims.generateFrameNumbers(name, { start: 0, end: sheet.frames - 1 }),
        frameRate: sheet.fps,
        repeat: -1,
      });
    }

    const loaded = await loadLots();
    const plan = planCityScene(loaded.lots);
    this.registry.set("lots", loaded.lots);
    this.registry.set("plan", plan);
    this.registry.set("generatedAt", loaded.generatedAt);
    this.registry.set("lotSource", loaded.source);

    const meta = document.getElementById("mast-meta");
    if (meta) {
      meta.textContent = `${loaded.lots.length} lots · ${loaded.source} · ${loaded.generatedAt}`;
    }

    document.getElementById("boot-card")?.setAttribute("hidden", "");
    this.scene.start(SceneKeys.City);
  }
}
