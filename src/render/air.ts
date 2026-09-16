import { fmt } from "./iso.js";

function bird(id: string, x: number, y: number, delay: number, span: number): string {
  const dur = 18 + (id.charCodeAt(id.length - 1) % 8);
  return (
    `<g class="air-bird" aria-hidden="true">` +
    `<g>` +
    `<animateTransform attributeName="transform" type="translate" ` +
    `values="${fmt(x)} ${fmt(y)};${fmt(x + span)} ${fmt(y - span * 0.18)};${fmt(x + span * 1.6)} ${fmt(y + 12)}" ` +
    `dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>` +
    `<path d="M0 0 q6 -4 10 0 q-4 -1 -5 -4 q-1 3 -5 4" fill="none" stroke="#2b2f36" stroke-width="1.4" stroke-linecap="round">` +
    `<animateTransform attributeName="transform" type="scale" values="1 1;1 0.55;1 1" dur="0.55s" repeatCount="indefinite"/>` +
    `</path>` +
    `</g></g>`
  );
}

function airliner(id: string, x: number, y: number, delay: number, span: number): string {
  const dur = 42 + (id.length % 10);
  return (
    `<g class="air-liner" aria-hidden="true">` +
    `<g opacity="0.9">` +
    `<animateTransform attributeName="transform" type="translate" ` +
    `values="${fmt(x)} ${fmt(y)};${fmt(x + span)} ${fmt(y + span * 0.22)}" ` +
    `dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>` +
    `<line x1="-90" y1="2" x2="-8" y2="2" stroke="rgba(240,244,248,0.7)" stroke-width="1.6"/>` +
    `<path d="M-6 0 L22 0 L26 -3 L28 0 L22 2 L8 2 L2 7 L-2 7 L4 2 L-8 2 Z" fill="#eef2f6" stroke="#6b7380" stroke-width="0.6"/>` +
    `<circle cx="24" cy="-1.2" r="1.1" fill="#c45c26"/>` +
    `</g></g>`
  );
}

function starlink(train: number, x: number, y: number, delay: number, span: number): string {
  let dots = "";
  for (let i = 0; i < 10; i++) {
    dots += `<circle cx="${fmt(-i * 14)}" cy="0" r="1.15" fill="#dce7ff" opacity="${fmt(0.95 - i * 0.06)}"/>`;
  }
  const dur = 28 + train * 3;
  return (
    `<g class="air-starlink" aria-hidden="true">` +
    `<g>` +
    `<animateTransform attributeName="transform" type="translate" ` +
    `values="${fmt(x)} ${fmt(y)};${fmt(x + span)} ${fmt(y + 8)}" ` +
    `dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>` +
    `${dots}` +
    `</g></g>`
  );
}

function cloud(id: number, x: number, y: number, scale: number, delay: number): string {
  const dur = 50 + (id % 7) * 8;
  return (
    `<g class="air-cloud" aria-hidden="true" opacity="0.55">` +
    `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})">` +
    `<animateTransform attributeName="transform" type="translate" additive="sum" ` +
    `values="0 0; 220 -18; 0 0" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>` +
    `<ellipse cx="0" cy="0" rx="38" ry="14" fill="#f5f7fa"/>` +
    `<ellipse cx="22" cy="-4" rx="24" ry="12" fill="#eef2f6"/>` +
    `<ellipse cx="-20" cy="-2" rx="20" ry="11" fill="#e8eef3"/>` +
    `</g></g>`
  );
}

function weatherVeil(x: number, y: number, w: number, h: number): string {
  let drops = "";
  for (let i = 0; i < 18; i++) {
    const dx = (i * 37) % w;
    const dy = (i * 53) % h;
    drops +=
      `<line x1="${fmt(x + dx)}" y1="${fmt(y + dy)}" x2="${fmt(x + dx - 4)}" y2="${fmt(y + dy + 10)}" ` +
      `stroke="rgba(120,150,180,0.35)" stroke-width="1">` +
      `<animate attributeName="y1" values="${fmt(y + dy)};${fmt(y + dy + h)}" dur="${fmt(2.4 + (i % 5) * 0.2)}s" repeatCount="indefinite"/>` +
      `<animate attributeName="y2" values="${fmt(y + dy + 10)};${fmt(y + dy + h + 10)}" dur="${fmt(2.4 + (i % 5) * 0.2)}s" repeatCount="indefinite"/>` +
      `</line>`;
  }
  return `<g class="air-weather" aria-hidden="true">${drops}</g>`;
}

/** Sky traffic and weather, planted in screen space over the developed city. */
export function renderAirLayer(
  vbX: number,
  vbY: number,
  vbW: number,
  vbH: number,
): string {
  const birds =
    bird("b1", vbX + vbW * 0.1, vbY + 40, 0, vbW * 0.55) +
    bird("b2", vbX + vbW * 0.18, vbY + 58, 3.5, vbW * 0.5) +
    bird("b3", vbX + vbW * 0.22, vbY + 50, 7, vbW * 0.48) +
    bird("b4", vbX + vbW * 0.65, vbY + 36, 11, -vbW * 0.4);
  const planes =
    airliner("p1", vbX - 40, vbY + 24, 0, vbW + 80) +
    airliner("p2", vbX + vbW + 20, vbY + 70, 18, -(vbW + 90));
  const sats =
    starlink(1, vbX - 30, vbY + 12, 2, vbW + 120) +
    starlink(2, vbX + vbW * 0.2, vbY + 8, 14, vbW * 0.9);
  const clouds =
    cloud(1, vbX + vbW * 0.2, vbY + 18, 1.1, 0) +
    cloud(2, vbX + vbW * 0.55, vbY + 8, 0.8, 9) +
    cloud(3, vbX + vbW * 0.8, vbY + 28, 1.3, 16);
  const rain = weatherVeil(vbX + vbW * 0.62, vbY + 4, vbW * 0.22, 90);
  return `<g id="air-layer" class="air-layer" pointer-events="none">${clouds}${sats}${planes}${birds}${rain}</g>`;
}
