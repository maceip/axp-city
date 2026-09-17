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
    expect(scale9).not.toMatch(/NinePanel|from ["'].*ninepanel/);
    expect(scale9).toContain("Phaser 4's NineSlice object is WebGL-only");
  });

  it("keeps sticky lot addresses on layout version 1", () => {
    expect(LAYOUT_VERSION).toBe(1);
  });
});
