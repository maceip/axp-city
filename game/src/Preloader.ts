import Phaser from "phaser";
import { requiredSheets } from "../../src/game/plan.js";
import { ANIM_SHEETS } from "../../src/render/sprites.js";
import { SceneKeys } from "./Boot.js";
import { CityConnection } from "./connection.js";
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
    this.load.on("loaderror", (file: Phaser.Loader.File) =>
      this.failures.push(file.key),
    );
    const animations = new Set(
      Object.values(ANIM_SHEETS).map((sheet) => sheet.file),
    );
    for (const file of requiredSheets())
      if (!animations.has(file))
        this.load.image(file, `/assets/sprites/${file}`);
    for (const [name, sheet] of Object.entries(ANIM_SHEETS))
      this.load.spritesheet(name, `/assets/sprites/${sheet.file}`, {
        frameWidth: sheet.width / sheet.cols,
        frameHeight: sheet.height / sheet.rows,
      });
  }
  async create(): Promise<void> {
    try {
      if (this.failures.length)
        throw new Error(`Missing city artwork: ${this.failures.join(", ")}`);
      for (const [name, sheet] of Object.entries(ANIM_SHEETS))
        if (!this.anims.exists(name))
          this.anims.create({
            key: name,
            frames: this.anims.generateFrameNumbers(name, {
              start: 0,
              end: sheet.frames - 1,
            }),
            frameRate: sheet.fps,
            repeat: -1,
          });
      const g = this.make.graphics({ x: 0, y: 0 });
      for (let frame = 0; frame < 4; frame++) {
        const x = frame * 24 + 12;
        const step = frame % 2 ? 3 : -3;
        g.fillStyle(0x4d3324);
        g.fillCircle(x, 6, 4);
        g.fillStyle(0xe9ae76);
        g.fillCircle(x, 8, 3);
        g.lineStyle(3, 0x32495c);
        g.lineBetween(x - 2, 21, x - 3 - step, 29);
        g.lineBetween(x + 2, 21, x + 3 + step, 29);
        g.lineStyle(3, 0xc56037);
        g.lineBetween(x - 4, 13, x - 7, 19 + step);
        g.lineBetween(x + 4, 13, x + 7, 19 - step);
        g.fillStyle(0xe59a4b);
        g.fillRoundedRect(x - 5, 11, 10, 12, 2);
      }
      g.generateTexture("humanWalk", 96, 32);
      g.destroy();
      const texture = this.textures.get("humanWalk");
      for (let frame = 0; frame < 4; frame++)
        texture.add(frame, 0, frame * 24, 0, 24, 32);
      this.anims.create({
        key: "humanWalk",
        frames: this.anims.generateFrameNumbers("humanWalk", {
          start: 0,
          end: 3,
        }),
        frameRate: 5,
        repeat: -1,
      });
      const connection = new CityConnection(
        () => {},
        () => {},
        () => {},
      );
      this.registry.set("snapshot", await connection.initial());
      document.getElementById("boot-card")!.hidden = true;
      this.scene.start(SceneKeys.City);
    } catch (error) {
      document.getElementById("boot-message")!.textContent =
        error instanceof Error ? error.message : "Unable to load the city";
      document.getElementById("retry")!.hidden = false;
    }
  }
}
