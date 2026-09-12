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
});
