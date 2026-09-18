import { existsSync, readFileSync } from "node:fs";
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
    expect(yml).toContain("pip install -r test/requirements.txt");
    expect(readFileSync("test/requirements.txt", "utf8")).toMatch(/^pillow>=/m);
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
    expect(src).toContain('setdefault("CITY_TRENDING", "0")');
    expect(src).not.toMatch(/DEVICEFARM|EMU_TOKEN/);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:e2e"]).toContain("env -u PLAYWRIGHT_SERVICE_URL -u PLAYWRIGHT_SERVICE_ACCESS_TOKEN");
    expect(pkg.scripts["test:e2e"]).toContain("CITY_LOCAL_BROWSER=1");
    expect(pkg.scripts["test:e2e"]).toContain("CITY_SOFTWARE_GL=1");
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

  it("does not advertise a pending reconstruction or a second city client", () => {
    const handoff = readFileSync("docs/PHASER-RECONSTRUCTION-HANDOFF.md", "utf8");
    const status = readFileSync("docs/RECONSTRUCTION-STATUS.md", "utf8");
    const readme = readFileSync("README.md", "utf8");
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

  it("keeps one Phaser 4 client on the shared live protocol", () => {
    const connection = readFileSync("game/src/connection.ts", "utf8");
    const protocol = readFileSync("src/live/protocol.ts", "utf8");
    const server = readFileSync("src/webhooks/server.ts", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies.phaser).toBe("4.2.1");
    expect(pkg.scripts.build).toContain("vite build --config game/vite.config.ts");
    expect(pkg.scripts.start).toBe("node dist/server/cli/server.js");
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

  it("titles the Phaser shell from the snapshot city, not a hardcoded Trending City", () => {
    const html = readFileSync("game/index.html", "utf8");
    const hud = readFileSync("game/src/HudScene.ts", "utf8");
    const pre = readFileSync("game/src/Preloader.ts", "utf8");
    const identity = readFileSync("game/src/identity.ts", "utf8");
    const city = readFileSync("game/src/CityScene.ts", "utf8");
    expect(html).toContain("<title>City</title>");
    expect(html).toContain("WELCOME TO THE CITY");
    expect(html).not.toContain("WELCOME TO TRENDING CITY");
    expect(identity).toContain("export function applyCityIdentity");
    expect(identity).toContain("document.title = name");
    expect(pre).toContain("applyCityIdentity(snapshot.city)");
    expect(hud).toContain("cityDisplayName(this.snapshot.city)");
    expect(hud).toContain("applyCityIdentity(snapshot.city)");
    expect(hud).not.toContain('"TRENDING CITY"');
    expect(hud).not.toMatch(/bg: Phaser\.GameObjects\.Graphics/);
    expect(city).toContain("shellTitle: document.title");
    expect(city).toContain("drawnLabels:");
  });
});
