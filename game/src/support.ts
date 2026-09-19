export type RendererChoice = "webgl" | "canvas";

export interface SupportReport {
  renderer: RendererChoice | null;
  reasons: string[];
  userAgent: string;
}

/**
 * Feature-detects what this browser can actually run before Phaser is even
 * loaded (Phaser's own device probes assume a working canvas): WebGL first,
 * the Canvas renderer as the documented fallback, and an explicit unsupported
 * screen when neither is available. `?renderer=canvas` forces the fallback.
 */
export function detectSupport(force?: string | null): SupportReport {
  const reasons: string[] = [];
  const userAgent = navigator.userAgent;
  if (
    typeof HTMLCanvasElement === "undefined" ||
    typeof document.createElement("canvas").getContext !== "function"
  ) {
    return {
      renderer: null,
      reasons: ["This browser cannot draw to a canvas."],
      userAgent,
    };
  }
  if (!("fetch" in window) || !("Promise" in window))
    reasons.push(
      "This browser lacks fetch or Promise support required to load the town.",
    );
  let webgl = false;
  try {
    // A canvas keeps its first context type, so each probe gets its own element.
    const probe = document.createElement("canvas");
    const gl = (probe.getContext("webgl2") ??
      probe.getContext("webgl")) as WebGLRenderingContext | null;
    webgl = Boolean(gl && !gl.isContextLost());
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  let canvas2d = false;
  try {
    canvas2d = Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    canvas2d = false;
  }
  if (!webgl)
    reasons.push(
      "WebGL is unavailable; using the Canvas renderer (slower, no GPU acceleration).",
    );
  if (force === "canvas")
    reasons.push("Canvas renderer forced by ?renderer=canvas.");
  if (reasons.some((r) => r.startsWith("This browser lacks")))
    return { renderer: null, reasons, userAgent };
  if (force === "canvas" && canvas2d)
    return { renderer: "canvas", reasons, userAgent };
  if (webgl) return { renderer: "webgl", reasons, userAgent };
  if (canvas2d) return { renderer: "canvas", reasons, userAgent };
  reasons.push("Neither WebGL nor a 2D canvas context could be created.");
  return { renderer: null, reasons, userAgent };
}
