import Phaser from "phaser";
import { CITY_ANIMATIONS, GENERATED_ANIMATIONS } from "../../src/game/plan.js";
import {
  ANIM_SHEETS,
  BUILDING_SHEETS,
  CIVIC_SHEET,
  GROUND_SHEET,
  HUD_SHEET,
  PROP_SHEETS,
  WILD_SHEETS,
} from "../../src/render/sprites.js";

/** Offline packages declare a relative asset base; the live site serves from the root. */
export const SPRITE_BASE =
  document.querySelector<HTMLMetaElement>('meta[name="city-asset-base"]')?.content || "/assets/sprites";

/** Sheets fetched before the first frame: ground, buildings and wild trees. */
export const CORE_SHEETS = [
  BUILDING_SHEETS.S.file,
  BUILDING_SHEETS.M.file,
  BUILDING_SHEETS.L.file,
  GROUND_SHEET.file,
  CIVIC_SHEET.file,
  HUD_SHEET.file,
  WILD_SHEETS.trees.file,
];

/** Sheets fetched on demand the first time a visible lot needs them. */
export const LAZY_SHEETS = [
  PROP_SHEETS.materials.file,
  PROP_SHEETS.planning.file,
  PROP_SHEETS.crew.file,
  PROP_SHEETS.drones.file,
];

/**
 * Loads sprite sheets, animation atlases and approved artwork when a visible
 * lot first needs them, so the roughly 15 MB kit is not a prerequisite for the
 * first frame. Callers ask `ready(key)`; when it is false the loader has been
 * asked to fetch it and `onReady` fires once the texture exists.
 */
export class AssetLoader {
  private pending = new Set<string>();
  private failed = new Set<string>();
  private listeners = new Set<(key: string) => void>();
  bytesRequested = 0;
  constructor(private readonly scene: Phaser.Scene) {
    scene.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => {
      if (!this.pending.delete(key)) return;
      if (CITY_ANIMATIONS.includes(key as (typeof CITY_ANIMATIONS)[number]))
        this.defineAnimation(key);
      for (const listener of this.listeners) listener(key);
    });
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.pending.delete(file.key);
      this.failed.add(file.key);
      for (const listener of this.listeners) listener(file.key);
    });
  }
  onReady(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  isFailed(key: string): boolean {
    return this.failed.has(key);
  }
  /** True when the texture is usable; otherwise schedules the fetch. */
  ready(key: string, url?: string): boolean {
    if (this.scene.textures.exists(key)) return true;
    if (this.failed.has(key) || this.pending.has(key)) return false;
    this.pending.add(key);
    const anim = ANIM_SHEETS[key];
    if (anim) {
      this.bytesRequested += anim.width * anim.height;
      this.scene.load.spritesheet(key, `${SPRITE_BASE}/${anim.file}`, {
        frameWidth: anim.width / anim.cols,
        frameHeight: anim.height / anim.rows,
      });
    } else if (key.startsWith("artwork:") && url) {
      this.scene.load.image(key, url);
    } else if (GENERATED_ANIMATIONS.includes(key as (typeof GENERATED_ANIMATIONS)[number])) {
      // Generated textures are created by the preloader; nothing to fetch.
      this.pending.delete(key);
      return false;
    } else {
      this.scene.load.image(key, `${SPRITE_BASE}/${key}`);
    }
    if (!this.scene.load.isLoading()) this.scene.load.start();
    return false;
  }
  private defineAnimation(key: string): void {
    const sheet = ANIM_SHEETS[key];
    if (!sheet || this.scene.anims.exists(key)) return;
    this.scene.anims.create({
      key,
      frames: this.scene.anims.generateFrameNumbers(key, { start: 0, end: sheet.frames - 1 }),
      frameRate: sheet.fps,
      repeat: -1,
    });
  }
  get inflight(): number {
    return this.pending.size;
  }
}
