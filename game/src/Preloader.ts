import Phaser from "phaser";
import { HUD_FONT } from "../../src/render/sprites.js";
import { SceneKeys } from "./Boot.js";
import { CORE_SHEETS, SPRITE_BASE } from "./assets.js";
import { CityConnection } from "./connection.js";
import { applyCityIdentity } from "./identity.js";

type Behaviour = "humanWalk" | "humanWork" | "humanCarry" | "humanWave";

/**
 * Loads only the sheets the first frame needs; yard props, crew atlases and
 * approved artwork stream in on demand (see `AssetLoader`). People and
 * vehicles are generated here so they never cost a network round trip.
 */
export class Preloader extends Phaser.Scene {
  private failures: string[] = [];
  constructor() {
    super(SceneKeys.Preloader);
  }
  preload(): void {
    this.load.on("progress", (progress: number) => {
      const bar = document.querySelector<HTMLElement>("#boot-bar span");
      if (bar) bar.style.width = `${progress * 100}%`;
    });
    this.load.on("loaderror", (file: Phaser.Loader.File) => this.failures.push(file.key));
    for (const file of CORE_SHEETS) this.load.image(file, `${SPRITE_BASE}/${file}`);
    this.load.bitmapFont(HUD_FONT.face, `${SPRITE_BASE}/${HUD_FONT.file}`, `${SPRITE_BASE}/${HUD_FONT.xml}`);
  }
  async create(): Promise<void> {
    try {
      if (this.failures.length) throw new Error(`Missing city artwork: ${this.failures.join(", ")}`);
      for (const behaviour of ["humanWalk", "humanWork", "humanCarry", "humanWave"] as Behaviour[])
        this.person(behaviour);
      this.vehicles();
      const connection = new CityConnection({ snapshot() {}, mutation() {}, status() {}, connection() {} });
      const snapshot = await connection.initial();
      applyCityIdentity(snapshot.city);
      this.registry.set("snapshot", snapshot);
      document.getElementById("boot-card")!.hidden = true;
      this.scene.start(SceneKeys.City);
    } catch (error) {
      document.getElementById("boot-message")!.textContent =
        error instanceof Error ? error.message : "Unable to load the city";
      document.getElementById("retry")!.hidden = false;
    }
  }

  /** Four-frame hard-hat figure; each behaviour has its own limb cycle. */
  private person(behaviour: Behaviour): void {
    if (this.textures.exists(behaviour)) return;
    const g = this.make.graphics({ x: 0, y: 0 });
    const vest = behaviour === "humanCarry" ? 0xe85d04 : behaviour === "humanWave" ? 0x2a9d8f : behaviour === "humanWork" ? 0xe59a4b : 0x3d5a80;
    const hat = behaviour === "humanWork" ? 0xf0c14a : 0xe9e2c8;
    for (let frame = 0; frame < 4; frame++) {
      const x = frame * 24 + 12;
      const step = frame % 2 ? 3 : -3;
      const walking = behaviour === "humanWalk" || behaviour === "humanCarry";
      // Legs
      g.lineStyle(3, 0x32495c);
      if (walking) {
        g.lineBetween(x - 2, 21, x - 3 - step, 29);
        g.lineBetween(x + 2, 21, x + 3 + step, 29);
      } else {
        g.lineBetween(x - 2, 21, x - 3, 29);
        g.lineBetween(x + 2, 21, x + 3, 29);
      }
      // Torso
      g.fillStyle(vest);
      g.fillRoundedRect(x - 5, 11, 10, 12, 2);
      g.fillStyle(0xf4f1ea);
      g.fillRect(x - 5, 18, 10, 1.5);
      // Arms per behaviour
      g.lineStyle(3, 0xe2b089);
      if (behaviour === "humanWalk") {
        g.lineBetween(x - 4, 13, x - 7, 19 + step);
        g.lineBetween(x + 4, 13, x + 7, 19 - step);
      } else if (behaviour === "humanCarry") {
        g.lineBetween(x - 4, 13, x - 6, 9);
        g.lineBetween(x + 4, 13, x + 6, 9);
        g.fillStyle(0xb8894c);
        g.fillRect(x - 6, 3 + (frame % 2), 12, 6);
        g.lineStyle(1, 0x6b4f2a).strokeRect(x - 6, 3 + (frame % 2), 12, 6);
      } else if (behaviour === "humanWork") {
        // Hammer swing: arm raised on even frames, down on odd.
        const up = frame % 2 === 0;
        g.lineBetween(x - 4, 13, x - 7, 19);
        g.lineBetween(x + 4, 13, up ? x + 8 : x + 9, up ? 6 : 17);
        g.lineStyle(2, 0x4d3324);
        g.lineBetween(up ? x + 8 : x + 9, up ? 6 : 17, up ? x + 12 : x + 13, up ? 3 : 19);
      } else {
        // Wave: right arm sweeps above the head.
        const sweep = [-3, 0, 3, 0][frame];
        g.lineBetween(x - 4, 13, x - 7, 19);
        g.lineBetween(x + 4, 13, x + 7 + sweep, 3);
      }
      // Head and hard hat
      g.fillStyle(0xe2b089);
      g.fillCircle(x, 8, 3);
      g.fillStyle(hat);
      g.fillRoundedRect(x - 4, 3, 8, 3, 1);
      g.fillRect(x - 5, 5.5, 10, 1.2);
    }
    g.generateTexture(behaviour, 96, 32);
    g.destroy();
    const texture = this.textures.get(behaviour);
    for (let frame = 0; frame < 4; frame++) texture.add(frame, 0, frame * 24, 0, 24, 32);
  }

  /** Isometric car (48×24) and tram (96×36), tinted per actor by the scene. */
  private vehicles(): void {
    if (!this.textures.exists("car")) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x222222, 0.35).fillEllipse(24, 21, 40, 6);
      g.fillStyle(0xffffff).fillRoundedRect(6, 9, 36, 10, 3);
      g.fillStyle(0xffffff).fillRoundedRect(14, 4, 18, 8, 2);
      g.fillStyle(0x9ad0ea).fillRoundedRect(16, 5, 14, 5, 1);
      g.fillStyle(0x1b1b1b).fillCircle(13, 19, 3).fillCircle(35, 19, 3);
      g.fillStyle(0xfff3b0).fillRect(40, 12, 3, 3);
      g.generateTexture("car", 48, 24);
      g.destroy();
      this.textures.get("car").add(0, 0, 0, 0, 48, 24);
    }
    if (!this.textures.exists("tram")) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x222222, 0.35).fillEllipse(48, 33, 88, 7);
      g.fillStyle(0xd9e4ee).fillRoundedRect(4, 10, 88, 18, 4);
      g.fillStyle(0xc44536).fillRect(4, 22, 88, 6);
      g.fillStyle(0x7fb7d4);
      for (let i = 0; i < 6; i++) g.fillRect(9 + i * 14, 13, 10, 7);
      g.fillStyle(0x3b3b3b).fillRect(8, 28, 80, 3);
      g.lineStyle(2, 0x555555).lineBetween(48, 10, 48, 2).lineBetween(40, 2, 56, 2);
      g.generateTexture("tram", 96, 36);
      g.destroy();
      this.textures.get("tram").add(0, 0, 0, 0, 96, 36);
    }
  }
}
