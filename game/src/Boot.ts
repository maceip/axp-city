import Phaser from "phaser";

export const SceneKeys = {
  Boot: "Boot",
  Preloader: "Preloader",
  City: "City",
  Hud: "Hud",
} as const;

export class Boot extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    const fonts = document.fonts;
    const ready = fonts
      ? fonts.load('16px "JetBrains Mono"').then(() => fonts.ready)
      : Promise.resolve();
    void ready.then(
      () => this.scene.start(SceneKeys.Preloader),
      () => this.scene.start(SceneKeys.Preloader),
    );
  }
}
