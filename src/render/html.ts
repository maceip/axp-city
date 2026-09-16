import type { CityLot } from "../types.js";
import { HIGH_PR_COUNT, RECENT_ACTIVITY_DAYS } from "../parser/thresholds.js";
import { planCity, type PlanOptions } from "../world/index.js";
import { mapClientScript } from "./clientScript.js";
import { planSnapshot, renderPlannedCity } from "./city.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function yardLabel(yard: CityLot["yard"]): string {
  return yard.replaceAll("_", " ");
}

function rows(lots: CityLot[]): string {
  return lots
    .map((lot) => {
      const props = [
        lot.showBlueprint ? "blueprint" : "",
        lot.showDraftingTable ? "table" : "",
        lot.showMaterials ? "materials" : "",
        lot.showCrew ? "crew" : "",
        lot.showDrone ? "drone" : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `<tr>
        <td><a href="${escapeHtml(lot.url)}">${escapeHtml(lot.fullName)}</a></td>
        <td>${lot.stars.toLocaleString()}</td>
        <td>${lot.openIssues}</td>
        <td>${lot.openPrs}</td>
        <td><span class="band">${lot.buildingBand}</span> ${String(lot.buildingId).padStart(2, "0")}</td>
        <td>${escapeHtml(lot.occupantClass)}</td>
        <td><span class="yard yard-${lot.yard}">${escapeHtml(yardLabel(lot.yard))}</span></td>
        <td>${escapeHtml(props || "—")}</td>
      </tr>`;
    })
    .join("\n");
}

const hudCss = `
    :root {
      --ink: #e8e4d9;
      --muted: #9aa3ad;
      --line: rgba(255,210,63,0.35);
      --paper: #1a1d1b;
      --card: #141716;
      --gold: #ffd23f;
      --hud: rgba(12,14,13,0.86);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background: var(--paper); color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      height: 100%;
    }
    body { min-height: 100dvh; overflow: hidden; }
    .stage {
      position: fixed; inset: 0;
      background: #0e1110;
      overflow: hidden;
      touch-action: none;
    }
    .stage svg { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
    .lot-hit { cursor: pointer; }
    .lot-hit:hover path { stroke: var(--gold); stroke-width: 2; }
    .lot-hit.selected path { stroke: var(--gold); stroke-width: 2.5; }
    .hovertag {
      position: absolute; left: 0; top: 0; z-index: 6;
      pointer-events: none;
      transform: rotate(-2deg);
    }
    .hovertag[hidden] { display: none; }
    .tag-pop {
      background: var(--gold);
      border: 3px solid #111;
      border-radius: 10px;
      box-shadow: 5px 5px 0 #111;
      padding: 8px 12px 9px;
      transform-origin: 15% 85%;
      animation: tag-pop .28s cubic-bezier(.2, 1.5, .35, 1);
    }
    .tag-name {
      font-style: italic; font-weight: 800; font-size: 15px;
      line-height: 1.05; letter-spacing: .01em;
      text-transform: uppercase; color: #111; white-space: nowrap;
    }
    .tag-sub {
      margin-top: 3px; font-size: 11px; font-weight: 700;
      letter-spacing: .04em; text-transform: uppercase; color: #111; white-space: nowrap;
    }
    @keyframes tag-pop {
      0% { transform: scale(.2) rotate(8deg); }
      60% { transform: scale(1.12) rotate(-2deg); }
      100% { transform: scale(1) rotate(0deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .tag-pop { animation: none; }
    }
    .wild-bush image { image-rendering: pixelated; }
    .hud {
      position: absolute; inset: 0; pointer-events: none; z-index: 8;
      color: var(--ink);
    }
    .hud button,
    .hud canvas,
    .hud .hud-plate,
    .hud .hud-compass-wrap,
    .hud .hud-mass,
    .hud .hud-log-btn {
      pointer-events: auto;
    }
    .hud-top, .hud-bottom, .hud-left, .hud-right {
      position: absolute;
    }
    .hud-top {
      top: max(10px, env(safe-area-inset-top));
      left: 12px; right: 12px;
      display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;
    }
    .hud-plate {
      background: var(--hud);
      border: 3px solid var(--gold);
      box-shadow: 4px 4px 0 #000;
      padding: 8px 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .hud-title { font-size: 13px; color: var(--gold); margin: 0; }
    .hud-district { font-size: 18px; font-weight: 800; margin: 2px 0 0; }
    .hud-clock { font-size: 11px; color: var(--muted); }
    .hud-compass-wrap {
      width: 64px; height: 64px;
      border: 3px solid var(--gold);
      background: var(--hud);
      box-shadow: 4px 4px 0 #000;
      display: grid; place-items: center;
      position: relative;
    }
    .hud-compass {
      width: 0; height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-bottom: 22px solid #e85d04;
      transform-origin: 50% 70%;
    }
    .hud-compass-wrap span {
      position: absolute; bottom: 4px; font-size: 10px; color: var(--gold);
    }
    .hud-right {
      top: 88px; right: 12px;
      display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
    }
    #hud-mini {
      width: 140px; height: 100px;
      border: 3px solid var(--gold);
      background: #0b0d0c;
      box-shadow: 4px 4px 0 #000;
      image-rendering: pixelated;
    }
    .hud-mass {
      width: 140px; background: var(--hud);
      border: 3px solid var(--gold); padding: 6px 8px;
      box-shadow: 4px 4px 0 #000;
    }
    .hud-mass label { font-size: 10px; color: var(--gold); }
    .hud-mass-bar { height: 8px; background: #2a2f2c; margin-top: 4px; }
    #hud-mass-fill { display: block; height: 100%; width: 0; background: var(--gold); }
    .hud-bottom {
      left: 12px; right: 12px;
      bottom: max(12px, env(safe-area-inset-bottom));
      display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
    }
    .dpad {
      display: grid;
      grid-template-columns: 48px 48px 48px;
      grid-template-rows: 48px 48px 48px;
      gap: 4px;
    }
    .dpad button, .zoomers button, .hud-log-btn {
      background: var(--hud);
      color: var(--gold);
      border: 3px solid var(--gold);
      box-shadow: 3px 3px 0 #000;
      font-family: inherit;
      font-weight: 800;
      font-size: 16px;
      cursor: pointer;
    }
    .dpad button:active, .zoomers button:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0 #000; }
    #pad-w { grid-column: 2; grid-row: 1; }
    #pad-a { grid-column: 1; grid-row: 2; }
    #pad-s { grid-column: 2; grid-row: 2; }
    #pad-d { grid-column: 3; grid-row: 2; }
    .zoomers { display: flex; flex-direction: column; gap: 6px; }
    .zoomers button, .hud-log-btn { width: 48px; height: 48px; }
    .hud-hint {
      pointer-events: none;
      background: var(--hud);
      border: 2px solid var(--line);
      padding: 6px 10px;
      font-size: 11px;
      color: var(--muted);
      max-width: 42ch;
    }
    #hud-toast {
      position: absolute; top: 96px; left: 50%; transform: translateX(-50%);
      background: var(--gold); color: #111; border: 3px solid #111;
      padding: 8px 14px; font-weight: 800; letter-spacing: 0.08em;
      box-shadow: 4px 4px 0 #000;
    }
    #hud-toast[hidden] { display: none; }
    .lotcard {
      position: absolute; right: 12px; top: 210px; width: min(280px, calc(100vw - 24px));
      background: var(--hud); border: 3px solid var(--gold);
      box-shadow: 5px 5px 0 #000; padding: 12px 14px; font-size: 13px; z-index: 9;
    }
    .lotcard[hidden] { display: none; }
    .lotcard h3 { margin: 0 0 6px; font-size: 15px; }
    .lotcard a { color: var(--gold); }
    .lotcard p { margin: 4px 0; color: var(--muted); }
    .lotcard .rpg-kicker { color: var(--gold); font-size: 10px; letter-spacing: 0.14em; margin: 0 0 4px; }
    .lotcard .rpg-stat { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
    .lotcard .rpg-build { color: #e85d04; font-weight: 800; }
    .lotcard .close {
      position: absolute; right: 8px; top: 6px; border: 0; background: none;
      font-size: 16px; cursor: pointer; color: var(--gold);
    }
    .census {
      position: absolute; left: 0; right: 0; bottom: 0;
      max-height: 46vh; overflow: auto;
      background: var(--hud); border-top: 3px solid var(--gold);
      padding: 12px 16px 24px; z-index: 10;
      display: none;
    }
    .census.open { display: block; }
    .census h2 { margin: 0 0 8px; font-size: 13px; color: var(--gold); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(255,210,63,0.12); font-size: 12px; }
    th { color: var(--muted); }
    a { color: var(--gold); text-decoration: none; }
    .legend { display: none; }
    @media (min-width: 900px) {
      .hud-hint { display: block; }
    }
    @media (max-width: 720px) {
      .hud-hint { display: none; }
      #hud-mini { width: 110px; height: 80px; }
      .dpad { grid-template-columns: 56px 56px 56px; grid-template-rows: 56px 56px 56px; }
      .dpad button, .zoomers button, .hud-log-btn { width: 56px; height: 56px; }
      .lotcard { top: auto; bottom: 96px; }
    }
`;

export function renderCityHtml(
  lots: CityLot[],
  generatedAt: string,
  options: PlanOptions = {},
): string {
  const plan = planCity(lots, options);
  const svg = renderPlannedCity(plan, generatedAt).replace(/^<\?xml[^>]*>\s*/, "");
  const snapshot = planSnapshot(plan);
  const planJson = JSON.stringify(snapshot).replaceAll("</", "<\\/");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <title>AXP City</title>
  <style>${hudCss}</style>
</head>
<body>
  <div class="stage">${svg}
    <div class="hud" aria-label="City HUD">
      <div class="hud-top">
        <div class="hud-plate">
          <p class="hud-title">AXP CITY</p>
          <p class="hud-district" id="hud-district">CENTRAL PARK</p>
          <p class="hud-clock">${lots.length} lots · ${escapeHtml(generatedAt)}</p>
        </div>
        <div class="hud-compass-wrap" title="Compass"><div class="hud-compass" id="hud-compass"></div><span>N</span></div>
      </div>
      <div class="hud-right">
        <canvas id="hud-mini" width="140" height="100" aria-label="Minimap"></canvas>
        <div class="hud-mass"><label>MASS</label><div class="hud-mass-bar"><span id="hud-mass-fill"></span></div></div>
      </div>
      <div id="hud-toast" hidden>NEW PLOT</div>
      <div class="hud-bottom">
        <div class="dpad" aria-label="Move">
          <button type="button" id="pad-w">W</button>
          <button type="button" id="pad-a">A</button>
          <button type="button" id="pad-s">S</button>
          <button type="button" id="pad-d">D</button>
        </div>
        <p class="hud-hint" id="hud-hint">WASD / arrows move · scroll zoom · drag pan</p>
        <div class="zoomers">
          <button type="button" id="hud-zoom-in" aria-label="Zoom in">+</button>
          <button type="button" id="hud-zoom-out" aria-label="Zoom out">−</button>
          <button type="button" class="hud-log-btn" id="hud-log-toggle" aria-label="Census">☰</button>
        </div>
      </div>
    </div>
    <div class="hovertag" id="hover-tag" aria-hidden="true" hidden></div>
    <div class="lotcard" id="lot-card" hidden></div>
    <div class="census" id="census">
      <h2>Lot census · activity window ${RECENT_ACTIVITY_DAYS} days · drone if PRs ≥ ${HIGH_PR_COUNT} or bot authors</h2>
      <table>
        <thead>
          <tr>
            <th>Repo</th><th>Stars</th><th>Issues</th><th>PRs</th><th>Building</th><th>Crew</th><th>Yard</th><th>Props</th>
          </tr>
        </thead>
        <tbody>
          ${rows(lots)}
        </tbody>
      </table>
    </div>
  </div>
  <script type="application/json" id="axp-lots">${JSON.stringify(snapshot.lots).replaceAll("</", "<\\/")}</script>
  <script type="application/json" id="axp-city-plan">${planJson}</script>
  <script>${mapClientScript()}</script>
  <script>
    (function () {
      var btn = document.getElementById("hud-log-toggle");
      var panel = document.getElementById("census");
      if (!btn || !panel) return;
      btn.addEventListener("click", function () { panel.classList.toggle("open"); });
    })();
  </script>
</body>
</html>
`;
}
