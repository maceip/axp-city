import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAYOUT_VERSION } from "../src/world/layout.js";

describe("Phaser #5 input and asset-failure locks", () => {
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

  it("fail-closes hosted Playwright instead of skipping green as hosted proof", () => {
    const yml = readFileSync(".github/workflows/verify.yml", "utf8");
    expect(yml).toContain("hosted-playwright:");
    expect(yml).toContain("hosted Playwright proof blocked");
    expect(yml).toContain("PLAYWRIGHT_SERVICE_URL is set without PLAYWRIGHT_SERVICE_ACCESS_TOKEN");
    expect(yml).toContain("browser-local:");
    expect(yml).toContain("python -m playwright install --with-deps");
    expect(yml).toContain("pip install pillow");
    expect(yml).toContain("CITY_LOCAL_BROWSER");
    expect(yml).not.toMatch(/echo "hosted=0"/);
    expect(yml).not.toMatch(/DEVICEFARM|EMU_TOKEN/);
  });

  it("defaults the browser harness to local Playwright when Azure is not configured", () => {
    const src = readFileSync("e2e/conftest.py", "utf8");
    expect(src).toContain("def launch_local");
    expect(src).toContain("CITY_LOCAL_BROWSER");
    expect(src).toContain("refusing an anonymous hosted connection");
    expect(src).toContain("Live GitHub failures never switch to fixtures");
    expect(src).not.toMatch(/DEVICEFARM|EMU_TOKEN/);
  });

  it("isolates the unused stretch panel so it cannot become the HUD", () => {
    const panel = readFileSync("game/src/ninepanel.ts", "utf8");
    expect(panel).toContain("UNUSED — isolated leftover");
    expect(panel).toContain("Do not import this file");
    const hud = readFileSync("game/src/HudScene.ts", "utf8");
    const city = readFileSync("game/src/CityScene.ts", "utf8");
    expect(hud).not.toMatch(/from ["'].*ninepanel/);
    expect(city).not.toMatch(/from ["'].*ninepanel/);
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
    expect(terrain).not.toMatch(/\.add\.text\(/);
    expect(terrain).not.toMatch(/fillText|GameObjects\.Text/);
  });

  it("docks the native search field inside a KEEP 9-slice well", () => {
    const hud = readFileSync("game/src/HudScene.ts", "utf8");
    const css = readFileSync("game/src/styles.css", "utf8");
    const html = readFileSync("game/index.html", "utf8");
    expect(hud).toContain("private layoutSearch(");
    expect(hud).toContain("private dockSearch(");
    expect(hud).toContain('this.searchWell.setName("search")');
    expect(html).toContain('id="repo-search"');
    expect(css).toContain("background: transparent");
    expect(css).not.toMatch(/\.search input[\s\S]{0,280}clip-path/);
    expect(hud).not.toMatch(/new NinePanel|from ["'].*ninepanel/);
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
});
