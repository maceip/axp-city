import { describe, expect, it } from "vitest";
import { parseCity } from "../src/parser/index.js";
import { renderCitySvg } from "../src/render/city.js";
import { renderCityHtml } from "../src/render/html.js";
import { FIXED_NOW, metrics } from "./helpers.js";

describe("renderCityHtml", () => {
  it("labels every lot with owner/name and does not invent states", () => {
    const lots = parseCity(
      [
        metrics({
          owner: "acme",
          name: "alpha",
          fullName: "acme/alpha",
          stars: 100,
        }),
        metrics({
          owner: "acme",
          name: "beta",
          fullName: "acme/beta",
          stars: 12_000,
          openPrs: 20,
          pushedAt: "2026-09-10T00:00:00Z",
        }),
      ],
      { now: FIXED_NOW },
    );
    const html = renderCityHtml(lots, FIXED_NOW);
    expect(html).toContain("acme/alpha");
    expect(html).toContain("acme/beta");
    expect(html).toContain("fully_dormant");
    expect(html).toContain("prs_active");
    expect(html).not.toContain("LegadoTeam/legado");
  });

  it("paints labels above buildings and gives every lot a click tile", () => {
    const lots = parseCity(
      [
        metrics({ fullName: "acme/alpha", stars: 100 }),
        metrics({ fullName: "acme/beta", stars: 12_000 }),
      ],
      { now: FIXED_NOW },
    );
    const svg = renderCitySvg(lots, FIXED_NOW);
    // Labels live in one trailing layer so later lots cannot cover them.
    const labelsAt = svg.indexOf('<g class="labels">');
    expect(labelsAt).toBeGreaterThan(-1);
    expect(labelsAt).toBeGreaterThan(svg.lastIndexOf('<g class="lot"'));
    expect(svg.match(/lot-label/g)?.length).toBe(2);
    // One transparent hit tile per lot, keyed by repo.
    expect(svg).toContain('class="lot-hit" data-repo="acme/alpha"');
    expect(svg).toContain('class="lot-hit" data-repo="acme/beta"');
  });

  it("embeds pan/zoom/click behavior and per-lot data", () => {
    const lots = parseCity([metrics({ fullName: "acme/alpha", stars: 100 })], {
      now: FIXED_NOW,
    });
    const html = renderCityHtml(lots, FIXED_NOW);
    expect(html).toContain('id="axp-map"');
    expect(html).toContain('id="axp-lots"');
    expect(html).toContain('id="lot-card"');
    expect(html).toContain("pointerdown");
    expect(html).toContain("dblclick");
    expect(html).toContain('"repo":"acme/alpha"');
  });

  it("stamps real sprite art with quiet dimming", () => {
    const lots = parseCity(
      [
        metrics({
          fullName: "acme/active",
          stars: 100,
          openPrs: 3,
          pushedAt: "2026-09-10T00:00:00Z",
        }),
        metrics({ fullName: "acme/quiet", stars: 100 }),
      ],
      { now: FIXED_NOW },
    );
    const svg = renderCitySvg(lots, FIXED_NOW);
    // Active: building + 1 pallet (3 PRs < HIGH_PR_COUNT) + animated
    // walker + crate-carrier + pallet-jack. Quiet dormant: dimmed building.
    // No drone at 3 PRs without bots. Decor: 4 trees + 2 lamps + 1 bench.
    expect(svg.match(/<image /g)?.length).toBe(13);
    expect(svg).toContain("v5-ground-tiles-kit.png");
    expect(svg).toContain("/assets/sprites/buildings-small-01-17.png");
    expect(svg).toContain("mix-blend-mode:multiply");
    expect(svg).toContain('clip-path="url(#clip-lot-');
    expect(svg).toContain('preserveAspectRatio="none"');
    // Quiet lot dims its stamp; the active one does not.
    expect(svg).toContain('opacity="0.62"');
  });

  it("stamps yard props per state and nothing on dormant lots", () => {
    const lots = parseCity(
      [
        metrics({
          fullName: "acme/busy",
          stars: 100,
          openPrs: 20,
          pushedAt: "2026-09-10T00:00:00Z",
          prAuthors: [{ login: "human", type: "User" }],
        }),
        metrics({
          fullName: "acme/planning",
          stars: 100,
          openIssues: 4,
          pushedAt: "2024-01-01T00:00:00Z",
        }),
        metrics({ fullName: "acme/dead", stars: 100 }),
      ],
      { now: FIXED_NOW },
    );
    const svg = renderCitySvg(lots, FIXED_NOW);
    // Busy PR lot: materials (density pair at 20 PRs), animated walkers,
    // hovering drone. Recent lots animate; static crew sheets stay stashed.
    expect(svg).toContain("v2-raw-materials.png");
    expect(svg).toContain("v6-anim-unit-walk.png");
    expect(svg).toContain("v6-anim-carry-crate.png");
    expect(svg).toContain("v6-anim-pallet-jack.png");
    expect(svg).toContain("v3-agent-drones.png");
    expect(svg).toContain('calcMode="discrete"');
    expect(svg).toContain('type="scale"');
    expect(svg).not.toContain("v3-robot-crew.png");
    // Planning lot: drafting table + blueprint sheet, no reader (stale).
    expect(svg).toContain("v2-planning-issues.png");
    expect(svg).not.toContain("v6-anim-blueprint.png");
    // Dormant lot: dimmed building, no props, no animation elements.
    const dormant = svg.split("acme/dead")[1] ?? "";
    expect(dormant).not.toContain("v2-raw-materials.png");
    expect(dormant).not.toContain("v3-robot-crew.png");
    expect(dormant).not.toContain("v6-anim-");
    expect(dormant).not.toContain("<animate");
    expect(dormant).not.toContain("<animateTransform");
  });

  it("wires hover cursor, glide camera, and keyboard movement", () => {
    const lots = parseCity([metrics({ fullName: "acme/alpha", stars: 100 })], {
      now: FIXED_NOW,
    });
    const html = renderCityHtml(lots, FIXED_NOW);
    expect(html).toContain(".lot-hit:hover");
    expect(html).toContain("requestAnimationFrame");
    expect(html).toContain("keydown");
  });
});
