import Phaser from "phaser";
import { Boot } from "./Boot.js";
import { CityScene } from "./CityScene.js";
import { Preloader } from "./Preloader.js";

export function createGame(parent: string): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    backgroundColor: "#91b477",
    pixelArt: false,
    antialias: true,
    roundPixels: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1280,
      height: 800,
    },
    render: {
      powerPreference: "high-performance",
      mipmapFilter: "LINEAR_MIPMAP_LINEAR",
    },
    scene: [Boot, Preloader, CityScene],
    fps: { target: 60 },
  });
}
