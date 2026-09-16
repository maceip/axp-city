import { describe, expect, it } from "vitest";
import { pickLot, screenToWorld, worldToScreen } from "../src/render/pick.js";

const lots = [
  { repo: "acme/pad", x: 0, y: 0, band: "S" as const },
  { repo: "acme/tower", x: 10, y: 4, band: "L" as const },
];

describe("pickLot", () => {
  it("round-trips world and screen coordinates", () => {
    const p = worldToScreen(3, 1.2);
    const w = screenToWorld(p.sx, p.sy);
    expect(w.x).toBeCloseTo(3, 6);
    expect(w.y).toBeCloseTo(1.2, 6);
  });

  it("hits a lot when the click is on the pad diamond", () => {
    const c = worldToScreen(2, 1.2);
    expect(pickLot(lots, c.sx, c.sy)?.repo).toBe("acme/pad");
  });

  it("hits a lot when the click is on the building slab above the pad", () => {
    const c = worldToScreen(10 + 2, 4 + 1.2);
    expect(pickLot(lots, c.sx, c.sy - 80)?.repo).toBe("acme/tower");
  });

  it("returns null for wilderness far from every lot", () => {
    expect(pickLot(lots, 8000, 8000)).toBeNull();
  });

  it("prefers the nearer building when slabs would otherwise overlap", () => {
    const close = [
      { repo: "near/a", x: 0, y: 0, band: "M" },
      { repo: "far/b", x: 20, y: 0, band: "M" },
    ];
    const c = worldToScreen(2, 1.2);
    expect(pickLot(close, c.sx, c.sy)?.repo).toBe("near/a");
  });
});
