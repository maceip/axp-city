import type { CityLot } from "../types.js";
import { HIGH_PR_COUNT, RECENT_ACTIVITY_DAYS } from "../parser/thresholds.js";
import { renderCitySvg } from "./city.js";

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

function propsList(lot: CityLot): string[] {
  return [
    lot.showBlueprint ? "blueprint" : "",
    lot.showDraftingTable ? "table" : "",
    lot.showMaterials ? "materials" : "",
    lot.showCrew ? "crew" : "",
    lot.showDrone ? "drone" : "",
  ].filter(Boolean);
}

/** Compact per-lot data for the click-to-inspect card. `</` neutralized. */
function lotsJson(lots: CityLot[]): string {
  const data = lots.map((lot) => ({
    repo: lot.fullName,
    url: lot.url,
    stars: lot.stars,
    issues: lot.openIssues,
    prs: lot.openPrs,
    band: lot.buildingBand,
    id: lot.buildingId,
    yard: lot.yard.replaceAll("_", " "),
    props: propsList(lot),
  }));
  return JSON.stringify(data).replaceAll("</", "<\\/");
}

const mapScript = `(function () {
  var svg = document.getElementById("axp-map");
  var card = document.getElementById("lot-card");
  if (!svg || !card) return;
  var lots = [];
  try { lots = JSON.parse(document.getElementById("axp-lots").textContent || "[]"); } catch (e) { lots = []; }
  var byRepo = {};
  lots.forEach(function (lot) { byRepo[lot.repo] = lot; });

  var base = svg.viewBox.baseVal;
  var home = { x: base.x, y: base.y, w: base.width, h: base.height };
  var view = { x: home.x, y: home.y, w: home.w, h: home.h };
  function apply() {
    svg.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);
  }
  function zoomTo(w) {
    view.w = Math.min(Math.max(w, home.w / 12), home.w * 1.5);
    view.h = view.w * home.h / home.w;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function hideCard() {
    card.hidden = true;
    card.innerHTML = "";
    var prev = svg.querySelector(".lot-hit.selected");
    if (prev) prev.classList.remove("selected");
  }
  function showCard(repo, hit) {
    var lot = byRepo[repo];
    if (!lot) return;
    svg.querySelectorAll(".lot-hit.selected").forEach(function (el) { el.classList.remove("selected"); });
    if (hit) hit.classList.add("selected");
    var props = lot.props.length ? lot.props.join(", ") : "—";
    card.innerHTML =
      '<button class="close" aria-label="Close">×</button>' +
      '<h3><a href="' + esc(lot.url) + '">' + esc(lot.repo) + "</a></h3>" +
      "<p>" + lot.stars.toLocaleString() + " stars · " + lot.issues + " issues · " + lot.prs + " PRs</p>" +
      "<p>Building " + esc(lot.band) + String(lot.id).padStart(2, "0") + " · " + esc(lot.yard) + "</p>" +
      "<p>Props: " + esc(props) + "</p>";
    card.hidden = false;
    card.querySelector(".close").addEventListener("click", hideCard);
  }
  function centerOn(hit) {
    try {
      var box = hit.getBBox();
      view.x = box.x + box.width / 2 - view.w / 2;
      view.y = box.y + box.height / 2 - view.h / 2;
      apply();
    } catch (e) { /* getBBox unavailable — selection still shows */ }
  }

  var dragging = false, lx = 0, ly = 0, moved = false;
  svg.addEventListener("pointerdown", function (e) {
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    try { svg.setPointerCapture(e.pointerId); } catch (err) {}
    svg.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 3) moved = true;
    var r = svg.getBoundingClientRect();
    view.x -= (e.clientX - lx) * (view.w / r.width);
    view.y -= (e.clientY - ly) * (view.h / r.height);
    lx = e.clientX; ly = e.clientY;
    apply();
  });
  function endDrag() { dragging = false; svg.style.cursor = "grab"; }
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("click", function (e) {
    if (moved) return;
    var hit = e.target && e.target.closest ? e.target.closest(".lot-hit") : null;
    if (!hit) { hideCard(); return; }
    showCard(hit.getAttribute("data-repo"), hit);
    centerOn(hit);
  });
  svg.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = svg.getBoundingClientRect();
    var mx = view.x + (e.clientX - r.left) * (view.w / r.width);
    var my = view.y + (e.clientY - r.top) * (view.h / r.height);
    var before = view.w;
    zoomTo(view.w * (e.deltaY > 0 ? 1.15 : 1 / 1.15));
    var k = view.w / before;
    view.x = mx - (mx - view.x) * k;
    view.y = my - (my - view.y) * k;
    apply();
  }, { passive: false });
  svg.addEventListener("dblclick", function () {
    view = { x: home.x, y: home.y, w: home.w, h: home.h };
    apply();
    hideCard();
  });
})();`;

function rows(lots: CityLot[]): string {
  return lots
    .map((lot) => {
      const props = propsList(lot).join(", ");
      return `<tr>
        <td><a href="${escapeHtml(lot.url)}">${escapeHtml(lot.fullName)}</a></td>
        <td>${lot.stars.toLocaleString()}</td>
        <td>${lot.openIssues}</td>
        <td>${lot.openPrs}</td>
        <td><span class="band">${lot.buildingBand}</span> ${String(lot.buildingId).padStart(2, "0")}</td>
        <td><span class="yard yard-${lot.yard}">${escapeHtml(yardLabel(lot.yard))}</span></td>
        <td>${escapeHtml(props || "—")}</td>
      </tr>`;
    })
    .join("\n");
}

export function renderCityHtml(lots: CityLot[], generatedAt: string): string {
  const svg = renderCitySvg(lots, generatedAt).replace(/^<\?xml[^>]*>\s*/, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>AXP City</title>
  <style>
    :root {
      --ink: #1f2933;
      --muted: #5b6773;
      --line: rgba(31,41,51,0.1);
      --paper: #f7f4ef;
      --card: #ffffff;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink); font-family: ui-sans-serif, system-ui, sans-serif; }
    header {
      padding: 14px 20px 6px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 10px;
      align-items: end;
    }
    h1 { margin: 0; font-size: 24px; letter-spacing: -0.03em; }
    .lede { margin: 4px 0 0; color: var(--muted); max-width: 68ch; line-height: 1.4; font-size: 14px; }
    .meta { color: var(--muted); font-size: 13px; }
    .stage {
      margin: 8px 16px 24px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(40,50,60,0.06);
      position: relative;
    }
    .stage svg { display: block; width: 100%; height: min(88vh, 980px); touch-action: none; cursor: grab; }
    .lot-hit { cursor: pointer; }
    .lot-hit.selected path { stroke: #2457c5; stroke-width: 2.5; }
    .maphint {
      position: absolute; left: 12px; bottom: 10px; margin: 0;
      background: rgba(255,255,255,0.92); border: 1px solid var(--line);
      border-radius: 999px; padding: 4px 12px; font-size: 12px; color: var(--muted);
      pointer-events: none;
    }
    .lotcard {
      position: absolute; right: 12px; top: 12px; width: 260px;
      background: rgba(255,255,255,0.97); border: 1px solid var(--line);
      border-radius: 12px; padding: 12px 14px; font-size: 13px;
      box-shadow: 0 8px 24px rgba(40,50,60,0.12);
    }
    .lotcard[hidden] { display: none; }
    .lotcard h3 { margin: 0 0 2px; font-size: 14px; }
    .lotcard p { margin: 4px 0; color: var(--muted); }
    .lotcard .close {
      position: absolute; right: 8px; top: 6px; border: 0; background: none;
      font-size: 16px; cursor: pointer; color: var(--muted);
    }
    .panel { padding: 0 24px 40px; }
    h2 { font-size: 16px; margin: 24px 0 10px; }
    .legend {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
    }
    .legend article {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .legend h3 { margin: 0 0 4px; font-size: 13px; }
    .legend p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 12px; overflow: hidden; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
    th { color: var(--muted); font-weight: 600; background: #f3f1ec; }
    a { color: #2457c5; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .band { font-weight: 700; }
    .yard { text-transform: capitalize; }
    .yard-fully_dormant { color: #7a6a4f; }
    .yard-issues_quiet, .yard-issues_active { color: #2b5f9e; }
    .yard-prs_quiet, .yard-prs_active { color: #8a4b20; }
    .yard-idle_active { color: #2f6d46; }
    @media (max-width: 720px) {
      header, .panel { padding-left: 14px; padding-right: 14px; }
      h1 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>AXP City</h1>
      <p class="lede">Each GitHub repository is two adjacent plots — a building pad sized by stars, and a receiving yard whose props come from open issues, open PRs, and recent activity. Nothing here is hardcoded per repo name.</p>
    </div>
    <p class="meta">${lots.length} lots · activity window ${RECENT_ACTIVITY_DAYS} days · drone if PRs ≥ ${HIGH_PR_COUNT} or bot authors · ${escapeHtml(generatedAt)}</p>
  </header>
  <div class="stage">${svg}
    <p class="maphint">drag to pan · scroll to zoom · click a lot to inspect · double-click to reset</p>
    <div class="lotcard" id="lot-card" hidden></div>
  </div>
  <script type="application/json" id="axp-lots">${lotsJson(lots)}</script>
  <script>${mapScript}</script>
  <div class="panel">
    <h2>Lot legend</h2>
    <div class="legend">
      <article><h3>Fully dormant</h3><p>No recent push/commits, no open issues or PRs. Empty dirt yard, quiet building.</p></article>
      <article><h3>Open issues · quiet</h3><p>Open issues, stale activity. Drafting table + blue blueprint. No ground crew.</p></article>
      <article><h3>Open issues · active</h3><p>Open issues and a recent push or default-branch commits. Blueprints plus biped crew.</p></article>
      <article><h3>Open PRs · quiet</h3><p>Open PRs, stale activity. Raw materials in the yard, empty sidewalk. PRs beat issues.</p></article>
      <article><h3>Open PRs · active</h3><p>Open PRs plus recent activity. Materials and movers. Drones when PR pressure is high or a bot is present.</p></article>
      <article><h3>Building bands</h3><p>S &lt; 5k stars (IDs 01–17) · M 5k–20k (18–34) · L ≥ 20k (35–50). Combined yards keep a small blueprint when issues and PRs coexist.</p></article>
    </div>
    <h2>Parsed lots</h2>
    <table>
      <thead>
        <tr>
          <th>Repo</th><th>Stars</th><th>Issues</th><th>PRs</th><th>Building</th><th>Yard</th><th>Props</th>
        </tr>
      </thead>
      <tbody>
        ${rows(lots)}
      </tbody>
    </table>
  </div>
</body>
</html>
`;
}
