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

export interface PixelSample {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Distinct colours after quantising to 4 bits per channel. */
  distinct: number;
  /** Row-major grid of average [r, g, b] per cell. */
  cells: number[][];
}

/**
 * Rendered-output probe for the browser suite: snapshot a screen rectangle of
 * the composited game and reduce it to a coarse colour grid, so tests can
 * prove that what is drawn changes with the data (and stays put when it
 * should) without committing reference bitmaps that differ per GPU.
 */
export function samplePixels(
  game: Phaser.Game,
  x: number,
  y: number,
  width: number,
  height: number,
  grid = 8,
): Promise<PixelSample> {
  const scale = game.scale.displayScale;
  const bounds = game.canvas;
  const px = Math.max(0, Math.round(x / scale.x));
  const py = Math.max(0, Math.round(y / scale.y));
  const pw = Math.min(bounds.width - px, Math.max(1, Math.round(width / scale.x)));
  const ph = Math.min(bounds.height - py, Math.max(1, Math.round(height / scale.y)));
  return new Promise((resolve, reject) => {
    if (pw <= 0 || ph <= 0) {
      reject(new Error("Sample rectangle is off screen"));
      return;
    }
    game.renderer.snapshotArea(
      px,
      py,
      pw,
      ph,
      (result) => {
        if (!(result instanceof HTMLImageElement)) {
          reject(new Error("Snapshot did not produce an image"));
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("2D context unavailable"));
          return;
        }
        ctx.drawImage(result, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const colours = new Set<number>();
        const sums = Array.from({ length: grid * grid }, () => [0, 0, 0, 0]);
        for (let row = 0; row < canvas.height; row++) {
          const cy = Math.min(grid - 1, Math.floor((row / canvas.height) * grid));
          for (let col = 0; col < canvas.width; col++) {
            const i = (row * canvas.width + col) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            colours.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
            const cx = Math.min(grid - 1, Math.floor((col / canvas.width) * grid));
            const cell = sums[cy * grid + cx];
            cell[0] += r;
            cell[1] += g;
            cell[2] += b;
            cell[3]++;
          }
        }
        resolve({
          x: px,
          y: py,
          width: canvas.width,
          height: canvas.height,
          distinct: colours.size,
          cells: sums.map(([r, g, b, n]) => (n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0])),
        });
      },
      "image/png",
    );
  });
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
