import Phaser from "phaser";
import { Boot } from "./Boot.js";
import { CityScene } from "./CityScene.js";
import { HudScene } from "./HudScene.js";
import { Preloader } from "./Preloader.js";
import type { RendererChoice } from "./support.js";

export { detectSupport, type RendererChoice, type SupportReport } from "./support.js";

export function createGame(parent: string, renderer: RendererChoice): Phaser.Game {
  return new Phaser.Game({
    type: renderer === "webgl" ? Phaser.WEBGL : Phaser.CANVAS,
    parent,
    backgroundColor: "#84966c",
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
      failIfMajorPerformanceCaveat: false,
    },
    scene: [Boot, Preloader, CityScene, HudScene],
    fps: { target: 60 },
  });
}
