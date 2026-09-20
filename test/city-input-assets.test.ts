import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAYOUT_VERSION } from "../src/world/layout.js";

// These checks cover retained GitHub-city source and integration contracts.
// The default core scene's behavior is exercised by e2e/test_core_city.py;
// retired search/title shell markup is deliberately no longer locked here.
describe("retained GitHub-city input and asset-failure locks", () => {
  it("keeps CityScene window shortcuts behind an event.repeat guard", () => {
    const src = readFileSync("game/src/CityScene.ts", "utf8");
    expect(src).toContain("if (event.repeat) return;");
    expect(src).toContain('window.addEventListener("keydown", onKey)');
    expect(src).toContain('key.toLowerCase() === "c"');
    expect(src).toContain('key === "/"');
    expect(src.includes("NinePanel")).toBe(false);
  });

  it("closes census when framing a lot and inspects after search", () => {
    const src = readFileSync("game/src/CityScene.ts", "utf8");
    expect(src).toContain("if (this.hudReady && this.hud.censusIsOpen && frame) this.hud.toggleCensus(false)");
    expect(src).toContain("const found = this.select(input.value, true)");
  });

  it("reports preload and lazy asset failures instead of drawing fixtures", () => {
    const pre = readFileSync("game/src/Preloader.ts", "utf8");
    const assets = readFileSync("game/src/assets.ts", "utf8");
    expect(pre).toContain('this.load.on("loaderror"');
    expect(pre).toContain("Missing city artwork");
    expect(assets).toContain("FILE_LOAD_ERROR");
    expect(assets).toContain("get failures()");
  });
});

describe("bitmap HUD redo", () => {
  it("keeps HudScene on BitmapText ink() and close-census, not NinePanel", () => {
    const hud = readFileSync("game/src/HudScene.ts", "utf8");
    expect(hud).toContain("function ink(");
    expect(hud).toContain("Phaser.GameObjects.BitmapText");
    expect(hud).toContain('this.button("close-census"');
    expect(hud).toContain("private hudPanel(");
    expect(hud).not.toMatch(/new NinePanel|from ["'].*ninepanel/);
  });

  it("tiles rectangular HUD plaques with Scale9Plaque instead of stretching KEEP faces", () => {
    const hud = readFileSync("game/src/HudScene.ts", "utf8");
    const scale9 = readFileSync("game/src/scale9.ts", "utf8");
    expect(hud).toContain('from "./scale9.js"');
    expect(hud).toContain("new Scale9Plaque");
    expect(hud).toContain("SCALE9_FRAMES");
    expect(hud).toContain("chromeInfo");
    expect(scale9).toContain("export class Scale9Plaque");
    expect(scale9).toContain("tile instead of smearing");
    expect(scale9).toContain("c === 1");
    expect(scale9).toContain("r === 1");
    expect(scale9).toContain("Octagon compass/dpad");
    expect(scale9).not.toMatch(/new NinePanel|from ["'].*ninepanel/);
    expect(scale9).toContain("Phaser 4's NineSlice object is WebGL-only");
    expect(hud).toContain('this.hudPanel("mast"');
    expect(scale9).toContain("scale9TileCount");
    expect(scale9).toContain('"mast"');
  });

  it("deletes the unused NinePanel leftover so Scale9Plaque is the only HUD chrome", () => {
    expect(existsSync("game/src/ninepanel.ts")).toBe(false);
    const hud = readFileSync("game/src/HudScene.ts", "utf8");
    const city = readFileSync("game/src/CityScene.ts", "utf8");
    const scale9 = readFileSync("game/src/scale9.ts", "utf8");
    expect(hud).not.toMatch(/ninepanel|NinePanel/);
    expect(city).not.toMatch(/ninepanel|NinePanel/);
    expect(scale9).not.toMatch(/from ["'].*ninepanel|new NinePanel/);
  });

  it("retains the completed historical Phaser reconstruction record", () => {
    const handoff = readFileSync("docs/PHASER-RECONSTRUCTION-HANDOFF.md", "utf8");
    const status = readFileSync("docs/RECONSTRUCTION-STATUS.md", "utf8");
    const readme = readFileSync("docs/INTEGRATIONS-ARCHIVE.md", "utf8");
    expect(handoff).toMatch(/Implemented on the single Phaser 4/);
    expect(handoff).not.toMatch(/The reconstruction below is pending/);
    expect(status).toContain("Scale9Plaque");
    expect(status).not.toMatch(/ninepanel\.ts/);
    expect(readme).toContain("There is no SVG city client");
    expect(readme).toContain("Phaser 4.2.1");
  });

  it("paints HUD copy once via BitmapText ink(), never Phaser.Text or fillText", () => {
    const hud = readFileSync("game/src/HudScene.ts", "utf8");
    const terrain = readFileSync("game/src/terrain.ts", "utf8");
    expect(hud).toContain("function ink(");
    expect(hud).toMatch(/scene\.add\.bitmapText\(x, y, HUD_FONT\.face, text, size\)/);
    expect(hud).toContain('"LOT CENSUS"');
    expect(hud).toContain('this.button("census", "CENSUS"');
    expect(hud).not.toMatch(/\.add\.text\(/);
    expect(hud).not.toMatch(/GameObjects\.Text[^a-zA-Z]/);
    expect(terrain).toContain('"BIKE LANE"');
    expect(terrain).toMatch(/bitmapText\(0, 1, HUD_FONT\.face, "BIKE LANE"/);
    expect(terrain).toContain("for (const label of plan.labels ?? [])");
    expect(terrain).toContain("streetLabel(label.x, label.y, label.text, label.id)");
    expect(terrain).toContain("function districtPlaque(");
    expect(terrain).toContain('setData("mapLabel"');
    expect(terrain).not.toContain("placeName(a.sx, a.sy, label.text");
    expect(terrain).not.toMatch(/\.add\s*\.\s*text\s*\(/);
    expect(terrain).not.toMatch(/fillText|GameObjects\.Text/);
  });

  it("crops Central Park from the park feature box, not the office pad", () => {
    const terrain = readFileSync("game/src/terrain.ts", "utf8");
    const e2e = readFileSync("e2e/test_tileset_revamp.py", "utf8");
    const layout = readFileSync("src/world/layout.ts", "utf8");
    expect(terrain).toContain("park: 0x355028");
    expect(terrain).toContain("vacant: 0x8ea070");
    expect(terrain).toContain('CIVIC_SPRITES["city-hall"]');
    expect(terrain).toContain("PARK_SX0 - 1");
    expect(e2e).toContain("featureScreenBox('central-park')");
    expect(e2e).toContain("tileset-park-flyover");
    expect(e2e).toContain("park_forest_share");
    expect(e2e).not.toMatch(/1040.*230/);
    expect(layout).toContain("export const LAYOUT_VERSION = 1");
  });

  it("tags freeway bike chevrons and crops them from the corridor, not the office pad", () => {
    const terrain = readFileSync("game/src/terrain.ts", "utf8");
    const city = readFileSync("game/src/CityScene.ts", "utf8");
    const e2e = readFileSync("e2e/test_tileset_revamp.py", "utf8");
    expect(terrain).toContain('ch.setData("bikeLaneFreeway", true)');
    expect(city).toContain("freeway: Boolean(object.getData(\"bikeLaneFreeway\"))");
    expect(e2e).toContain("featureScreenBox('freeway-bike-lane')");
    expect(e2e).toContain("inside_corridor");
    expect(e2e).toContain("mark_clip[\"height\"] <= 160");
    expect(e2e).not.toMatch(/1040.*230/);
  });

  it("keeps sticky lot addresses on layout version 1", () => {
    expect(LAYOUT_VERSION).toBe(1);
  });

  it("retains the integration protocol and Phaser build contract", () => {
    const connection = readFileSync("game/src/connection.ts", "utf8");
    const protocol = readFileSync("src/live/protocol.ts", "utf8");
    const server = readFileSync("src/webhooks/server.ts", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies.phaser).toBe("4.2.1");
    expect(pkg.scripts.build).toContain("vite build --config game/vite.config.ts");
    expect(connection).toContain('from "../../src/live/protocol.js"');
    expect(connection).toContain("SNAPSHOT_SCHEMA");
    expect(connection).toContain('if (!v.city) v.city = { name: "AXP City", kind: "standard" }');
    expect(connection).toContain("if (!v.plan!.labels) v.plan!.labels = []");
    expect(protocol).toContain("export const SNAPSHOT_SCHEMA = 2");
    expect(protocol).toContain('export type CityKind = "trending" | "standard"');
    expect(protocol).toContain("city: CityIdentity");
    expect(server).toContain('renderer: "phaser-4"');
    expect(server).toContain('options.clientRoot ?? "dist/game"');
    expect(server).not.toContain("out/city.html");
  });

});
