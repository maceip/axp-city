import { describe, expect, it } from "vitest";
import { parseCity } from "../src/parser/index.js";
import { buildingTargetWidth, renderCitySvg } from "../src/render/city.js";
import { renderCityHtml } from "../src/render/html.js";
import { FIXED_NOW, metrics } from "./helpers.js";

/** Slice one lot's own group out of the svg (balanced <g> scan). */
function lotGroup(svg: string, repo: string): string {
  const attr = svg.indexOf(`data-repo="${repo}"`);
  const start = svg.lastIndexOf('<g class="lot"', attr);
  const tags = /<\/?g[\s>]/g;
  tags.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tags.exec(svg)) !== null) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return svg.slice(start, m.index + 4);
  }
  throw new Error(`unbalanced group for ${repo}`);
}

describe("renderCityHtml", () => {
  it("lists every lot with owner/name and does not invent states", () => {
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

  it("hides persistent labels and gives every lot a click tile", () => {
    const lots = parseCity(
      [
        metrics({ fullName: "acme/alpha", stars: 100 }),
        metrics({ fullName: "acme/beta", stars: 12_000 }),
      ],
      { now: FIXED_NOW },
    );
    const svg = renderCitySvg(lots, FIXED_NOW);
    // The map loads unlabeled; hover tags are HTML, not SVG text.
    expect(svg).not.toContain("lot-label");
    expect(svg).not.toContain('<g class="labels">');
    const html = renderCityHtml(lots, FIXED_NOW);
    expect(html).toContain('id="hover-tag"');
    expect(html).toContain("tag-pop");
    // One transparent hit tile per lot, keyed by repo. Include a vertical
    // rect so building sprites (not just the pad diamond) receive clicks.
    expect(svg).toContain('class="lot-hit" data-repo="acme/alpha"');
    expect(svg).toContain('class="lot-hit" data-repo="acme/beta"');
    expect(svg).toMatch(/class="lot-hit"[^>]*>[\s\S]*?<rect[^>]*fill="rgba\(0,0,0,0\)"/);
  });

  it("embeds pan/zoom/click behavior and per-lot data", () => {
    const lots = parseCity([metrics({ fullName: "acme/alpha", stars: 100 })], {
      now: FIXED_NOW,
    });
    const html = renderCityHtml(lots, FIXED_NOW);
    expect(html).toContain('id="axp-map"');
    expect(html).toContain('id="axp-lots"');
    expect(html).toContain('id="lot-card"');
    expect(html).toContain('id="hover-tag"');
    expect(html).toContain("pointerdown");
    expect(html).toContain("pointermove");
    expect(html).toContain("data-infinite");
    expect(html).toContain("data-world");
    expect(html).toContain("dblclick");
    expect(html).toContain('"repo":"acme/alpha"');
    expect(html).toContain("id=\"hud-district\"");
    expect(html).toContain("id=\"hud-mini\"");
    expect(html).toContain("pad-w");
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
    expect((svg.match(/<image /g) ?? []).length).toBeGreaterThan(20);
    expect(svg).toContain("v5-ground-tiles-kit-k1.png");
    expect(svg).toContain("v8-wild-trees-k1.png");
    expect(svg).toContain("v8-wild-bushes-k1.png");
    expect(svg).toContain('class="wild-tree"');
    expect(svg).toContain("city-park");
    expect(svg).toContain("city-freeway");
    expect(svg).toContain("city-tram");
    expect(svg).toContain("iso-grass");
    expect(svg).toContain('data-infinite="1"');
    expect(svg).toContain('data-world="');
    expect(svg).toContain("/assets/sprites/buildings-small-01-17-k1.png");
    // Occlusion contract: keyed sheets composite normally so buildings
    // hide what is behind them instead of ghosting through it.
    expect(svg).not.toContain("mix-blend-mode");
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
    // animated cargo drone. Recent lots animate; static sheets stay stashed.
    expect(svg).toContain("v2-raw-materials-k1.png");
    expect(svg).toContain("v6-anim-unit-walk.png");
    expect(svg).toContain("v6-anim-carry-crate.png");
    expect(svg).toContain("v6-anim-pallet-jack.png");
    expect(svg).toContain("v7-anim-cargo-drone.png");
    expect(svg).toContain('calcMode="discrete"');
    expect(svg).toContain('type="scale"');
    expect(svg).not.toContain("v3-agent-drones-k1.png");
    expect(svg).not.toContain("v3-robot-crew-k1.png");
    // Planning lot: drafting table + blueprint sheet, no reader (stale).
    expect(svg).toContain("v2-planning-issues-k1.png");
    expect(svg).not.toContain("v6-anim-blueprint.png");
    // Dormant lot: dimmed building, no props, no animation elements.
    const dormant = lotGroup(svg, "acme/dead");
    expect(dormant).not.toContain("v2-raw-materials-k1.png");
    expect(dormant).not.toContain("v3-robot-crew-k1.png");
    expect(dormant).not.toContain("v6-anim-");
    expect(dormant).not.toContain("v7-anim-");
    expect(dormant).not.toContain("<animate");
    expect(dormant).not.toContain("<animateTransform");
  });

  it("works bot-tended yards with the robot crew, not the human crew", () => {
    const lots = parseCity(
      [
        metrics({
          fullName: "acme/bots",
          stars: 100,
          openPrs: 4,
          openIssues: 2,
          pushedAt: "2026-09-10T00:00:00Z",
          prAuthors: [{ login: "dependabot[bot]", type: "Bot" }],
        }),
      ],
      { now: FIXED_NOW },
    );
    expect(lots[0].botDetected).toBe(true);
    const svg = renderCitySvg(lots, FIXED_NOW);
    expect(svg).toContain("v7-anim-quad-dog.png");
    expect(svg).toContain("v7-anim-platform-rover.png");
    expect(svg).toContain("v7-anim-cargo-drone.png");
    expect(svg).toContain("v7-anim-crane-arm.png");
    // The yard itself runs the robot crew; street pacers still walk outside.
    const yard = lotGroup(svg, "acme/bots");
    expect(yard).not.toContain("v6-anim-unit-walk.png");
    expect(yard).not.toContain("v6-anim-carry-crate.png");
    expect(yard).not.toContain("v6-anim-pallet-jack.png");
    expect(yard).not.toContain("v6-anim-blueprint.png");
    expect(svg).toContain('class="road-life"');
  });

  it("parks a dimmed static quad on stale high-pressure yards", () => {
    const lots = parseCity(
      [
        metrics({
          fullName: "acme/pressure",
          stars: 100,
          openPrs: 20,
          pushedAt: "2024-01-01T00:00:00Z",
        }),
      ],
      { now: FIXED_NOW },
    );
    const svg = renderCitySvg(lots, FIXED_NOW);
    expect(svg).toContain("v3-agent-drones-k1.png");
    expect(svg).toContain('opacity="0.62"');
    expect(svg).not.toContain("v7-anim-cargo-drone.png");
    // The stale yard itself stays frozen; only the street pacers move.
    const yard = lotGroup(svg, "acme/pressure");
    expect(yard).not.toContain("<animate");
    expect(yard).not.toContain("<animateTransform");
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

  it("sizes buildings by band so sheds read smaller than towers", () => {
    const s = buildingTargetWidth("S");
    const m = buildingTargetWidth("M");
    const l = buildingTargetWidth("L");
    expect(s).toBeLessThan(m);
    expect(m).toBeLessThan(l);
    // A lot is 144px wide: even landmarks stay near their own pad.
    expect(l).toBeLessThanOrEqual(168);
  });

  it("paints RPG HUD chrome, touch pad, and live plan data", () => {
    const lots = parseCity([metrics({ fullName: "acme/alpha", stars: 100 })], {
      now: FIXED_NOW,
    });
    const html = renderCityHtml(lots, FIXED_NOW);
    expect(html).toContain("id=\"hud-district\"");
    expect(html).toContain("id=\"hud-compass\"");
    expect(html).toContain("id=\"hud-mini\"");
    expect(html).toContain("id=\"pad-w\"");
    expect(html).toContain("pinch");
    expect(html).toContain("/api/city/stream");
    expect(html).toContain("id=\"axp-city-plan\"");
    expect(html).toContain("getScreenCTM");
    expect(html).toContain("axpInspectAt");
  });

  it("renders air traffic and weather over the city", () => {
    const lots = parseCity([metrics({ fullName: "acme/alpha", stars: 100 })], {
      now: FIXED_NOW,
    });
    const svg = renderCitySvg(lots, FIXED_NOW);
    expect(svg).toContain("air-layer");
    expect(svg).toContain("air-bird");
    expect(svg).toContain("air-liner");
    expect(svg).toContain("air-starlink");
    expect(svg).toContain("air-cloud");
    expect(svg).toContain("air-weather");
  });

  it("puts humans on human yards and robots/drones on AI yards", () => {
    const lots = parseCity(
      [
        metrics({
          fullName: "acme/people",
          stars: 100,
          openPrs: 3,
          pushedAt: "2026-09-10T00:00:00Z",
          prAuthors: [{ login: "human", type: "User" }],
        }),
        metrics({
          fullName: "acme/agents",
          stars: 100,
          openPrs: 4,
          pushedAt: "2026-09-10T00:00:00Z",
          prAuthors: [{ login: "dependabot[bot]", type: "Bot" }],
        }),
      ],
      { now: FIXED_NOW },
    );
    expect(lots[0].occupantClass).toBe("human");
    expect(lots[1].occupantClass).toBe("robot");
    const svg = renderCitySvg(lots, FIXED_NOW);
    expect(svg).toContain('data-occupant="human"');
    expect(svg).toContain('data-occupant="robot"');
    const people = lotGroup(svg, "acme/people");
    expect(people).toContain("human-crew");
    expect(people).toContain("v6-anim-unit-walk.png");
    expect(people).not.toContain("v7-anim-quad-dog.png");
    const agents = lotGroup(svg, "acme/agents");
    expect(agents).toContain("v7-anim-quad-dog.png");
    expect(agents).toContain("v7-anim-cargo-drone.png");
    expect(agents).not.toContain("human-crew");
  });

  it("plays an under-construction site on a newly plotted lot", () => {
    const lots = parseCity([metrics({ fullName: "acme/new", stars: 800 })], {
      now: FIXED_NOW,
    });
    const svg = renderCitySvg(lots, FIXED_NOW, { constructing: ["acme/new"] });
    expect(svg).toContain("class=\"lot constructing\"");
    expect(svg).toContain("class=\"construction\"");
    expect(svg).toContain("v7-anim-crane-arm.png");
  });

  it("stamps each building at one of three sizes via data-size", () => {
    const lots = parseCity(
      [
        metrics({ fullName: "a/s", stars: 10 }),
        metrics({ fullName: "a/m", stars: 12_000 }),
        metrics({ fullName: "a/l", stars: 40_000 }),
      ],
      { now: FIXED_NOW },
    );
    const svg = renderCitySvg(lots, FIXED_NOW);
    expect(svg).toContain('data-size="S"');
    expect(svg).toContain('data-size="M"');
    expect(svg).toContain('data-size="L"');
  });
});
