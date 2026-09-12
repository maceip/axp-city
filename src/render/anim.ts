import { fmt } from "./iso.js";
import type { AnimSheet } from "./sprites.js";

/**
 * SMIL sprite animation for transparent crew atlases.
 *
 * One scaled whole-sheet <image> sits behind a fixed cell-size clip; two
 * discrete <animate> elements step the sheet so each grid cell shows in turn
 * (SMIL `calcMode="discrete"`, ~8 fps per the pack READMEs). Figures with a
 * `pace` also glide back and forth along a short screen-space leg and mirror
 * about their plant point on the return, so walkers never moonwalk. Without
 * SMIL support the SVG still shows frame 0 standing at the anchor.
 */
export interface AnimFigure {
  /** Unique clip id prefix (caller guarantees uniqueness per page). */
  id: string;
  sheet: AnimSheet;
  /** Screen anchor: bottom-center of the figure in pixels. */
  anchorX: number;
  anchorY: number;
  /** Figure width in pixels (cell aspect sets the height). */
  targetW: number;
  /** Negative SMIL begin offset in seconds; staggers loops across lots. */
  phase?: number;
  /** Back-and-forth glide; `legs` = gait loops per leg. */
  pace?: { dx: number; dy: number; legs: number };
  /** In-place vertical bob amplitude in pixels (for planted work loops). */
  bob?: number;
}

function frameXY(
  sheet: AnimSheet,
  frame: number,
  clipX: number,
  clipY: number,
  scale: number,
): { x: number; y: number } {
  const cellW = (sheet.width / sheet.cols) * scale;
  const cellH = (sheet.height / sheet.rows) * scale;
  return {
    x: clipX - (frame % sheet.cols) * cellW,
    y: clipY - Math.floor(frame / sheet.cols) * cellH,
  };
}

export function animatedFigure(fig: AnimFigure): string {
  const { sheet } = fig;
  const cellW = sheet.width / sheet.cols;
  const cellH = sheet.height / sheet.rows;
  const scale = fig.targetW / cellW;
  const fw = cellW * scale;
  const fh = cellH * scale;
  const clipX = fig.anchorX - fw / 2;
  const clipY = fig.anchorY - fh;
  const imgW = sheet.width * scale;
  const imgH = sheet.height * scale;
  const loopDur = sheet.frames / sheet.fps;
  const begin = fig.phase ?? 0;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let f = 0; f < sheet.frames; f++) {
    const p = frameXY(sheet, f, clipX, clipY, scale);
    xs.push(p.x);
    ys.push(p.y);
  }
  const clipId = `anim-${fig.id}`;
  const figure =
    `<clipPath id="${clipId}"><rect x="${fmt(clipX)}" y="${fmt(clipY)}" width="${fmt(fw)}" height="${fmt(fh)}"/></clipPath>` +
    `<image href="/assets/sprites/${sheet.file}" x="${fmt(xs[0])}" y="${fmt(ys[0])}" width="${fmt(imgW)}" height="${fmt(imgH)}" clip-path="url(#${clipId})">` +
    `<animate attributeName="x" values="${xs.map(fmt).join(";")}" dur="${loopDur}s" calcMode="discrete" repeatCount="indefinite" begin="${begin}s"/>` +
    `<animate attributeName="y" values="${ys.map(fmt).join(";")}" dur="${loopDur}s" calcMode="discrete" repeatCount="indefinite" begin="${begin}s"/>` +
    `</image>`;

  if (fig.pace) {
    // Out-and-back glide; the flip swaps exactly at each turnaround.
    const legDur = fig.pace.legs * loopDur;
    const paceDur = legDur * 2;
    const { dx, dy } = fig.pace;
    const ax = fmt(fig.anchorX);
    const ay = fmt(fig.anchorY);
    return (
      `<g>` +
      `<animateTransform attributeName="transform" type="translate" values="0 0;${fmt(dx)} ${fmt(dy)};0 0" keyTimes="0;0.5;1" dur="${paceDur}s" repeatCount="indefinite" begin="${begin}s"/>` +
      `<g transform="translate(${ax} ${ay})"><g>` +
      `<animateTransform attributeName="transform" type="scale" values="1 1;-1 1;1 1" keyTimes="0;0.5;1" calcMode="discrete" dur="${paceDur}s" repeatCount="indefinite" begin="${begin}s"/>` +
      `<g transform="translate(${fmt(-fig.anchorX)} ${fmt(-fig.anchorY)})">${figure}</g>` +
      `</g></g></g>`
    );
  }
  if (fig.bob) {
    return (
      `<g>` +
      `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${fmt(-fig.bob)};0 0" keyTimes="0;0.5;1" dur="${loopDur}s" repeatCount="indefinite" begin="${begin}s"/>` +
      `${figure}</g>`
    );
  }
  return `<g>${figure}</g>`;
}

/** Gentle hover for an already-rendered static stamp (drones). */
export function bobWrap(svg: string, amplitude: number, dur: number, phase: number): string {
  return (
    `<g><animateTransform attributeName="transform" type="translate" ` +
    `values="0 0;0 ${fmt(-amplitude)};0 0" keyTimes="0;0.5;1" dur="${dur}s" ` +
    `repeatCount="indefinite" begin="${phase}s"/>${svg}</g>`
  );
}
