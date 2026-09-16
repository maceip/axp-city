import Phaser from "phaser";

/**
 * Image capture of the live Phaser city: the renderer snapshots the composited
 * canvas (city and HUD scenes) and the browser downloads it. Exposed on
 * `window.__AXP.capture()` as well so tests can inspect the bytes.
 */
export function captureImage(game: Phaser.Game): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    try {
      game.renderer.snapshot((result) => {
        if (result instanceof HTMLImageElement) resolve(result);
        else reject(new Error("Snapshot did not produce an image"));
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

export async function captureDataUrl(game: Phaser.Game): Promise<string> {
  const image = await captureImage(game);
  return image.src;
}

export function downloadCapture(game: Phaser.Game, filename: string, done?: () => void): void {
  void captureImage(game).then((image) => {
    const link = document.createElement("a");
    link.href = image.src;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    (window as unknown as { __AXP_LAST_CAPTURE?: string }).__AXP_LAST_CAPTURE = image.src;
    done?.();
  });
}
