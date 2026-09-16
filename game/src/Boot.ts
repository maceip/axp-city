import Phaser from "phaser";

export const SceneKeys = {
  Boot: "Boot",
  Preloader: "Preloader",
  City: "City",
} as const;

export class Boot extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    this.scene.start(SceneKeys.Preloader);
  }
}
