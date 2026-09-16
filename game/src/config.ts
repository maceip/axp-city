import Phaser from "phaser";
import { Boot } from "./Boot.js";
import { CityScene } from "./CityScene.js";
import { HudScene } from "./HudScene.js";
import { Preloader } from "./Preloader.js";

export type RendererChoice = "webgl" | "canvas";

export interface SupportReport {
  renderer: RendererChoice | null;
  reasons: string[];
  userAgent: string;
}

/**
 * Feature-detects what this browser can actually run: WebGL first, the Canvas
 * renderer as the documented fallback, and an explicit unsupported screen when
 * neither is available. `?renderer=canvas` forces the fallback for testing.
 */
export function detectSupport(force?: string | null): SupportReport {
  const reasons: string[] = [];
  const userAgent = navigator.userAgent;
  if (typeof document.createElement("canvas").getContext !== "function") {
    return { renderer: null, reasons: ["This browser cannot draw to a canvas."], userAgent };
  }
  if (!("fetch" in window) || !("EventSource" in window) || !("Promise" in window))
    reasons.push("This browser lacks fetch, EventSource or Promise support required for live city data.");
  const probe = document.createElement("canvas");
  let webgl = false;
  try {
    const gl = (probe.getContext("webgl2") ?? probe.getContext("webgl")) as WebGLRenderingContext | null;
    webgl = Boolean(gl && !gl.isContextLost());
    if (gl) {
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    }
  } catch {
    webgl = false;
  }
  let canvas2d = false;
  try {
    canvas2d = Boolean(probe.getContext("2d"));
  } catch {
    canvas2d = false;
  }
  if (!webgl) reasons.push("WebGL is unavailable; using the Canvas renderer (slower, no GPU acceleration).");
  if (force === "canvas") reasons.push("Canvas renderer forced by ?renderer=canvas.");
  if (reasons.some((r) => r.startsWith("This browser lacks"))) return { renderer: null, reasons, userAgent };
  if (force === "canvas" && canvas2d) return { renderer: "canvas", reasons, userAgent };
  if (webgl) return { renderer: "webgl", reasons, userAgent };
  if (canvas2d) return { renderer: "canvas", reasons, userAgent };
  reasons.push("Neither WebGL nor a 2D canvas context could be created.");
  return { renderer: null, reasons, userAgent };
}

export function createGame(parent: string, renderer: RendererChoice): Phaser.Game {
  return new Phaser.Game({
    type: renderer === "webgl" ? Phaser.WEBGL : Phaser.CANVAS,
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
      failIfMajorPerformanceCaveat: false,
    },
    scene: [Boot, Preloader, CityScene, HudScene],
    fps: { target: 60 },
  });
}
