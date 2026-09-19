import Phaser from "phaser";
import { CoreScene } from "./core/CoreScene.js";
import type { RendererChoice } from "./support.js";
export {
  detectSupport,
  type RendererChoice,
  type SupportReport,
} from "./support.js";
export function createGame(
  parent: string,
  renderer: RendererChoice,
): Phaser.Game {
  return new Phaser.Game({
    type: renderer === "webgl" ? Phaser.WEBGL : Phaser.CANVAS,
    parent,
    backgroundColor: "#dce5d3",
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
      failIfMajorPerformanceCaveat: false,
    },
    scene: [CoreScene],
    fps: { target: 60 },
  });
}
