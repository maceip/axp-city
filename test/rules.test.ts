import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseBuildingRules,
  parseLoadingZoneRules,
  yardPropList,
} from "../src/rules/cityFiles.js";
import { parseCity } from "../src/parser/index.js";
import { FIXED_NOW, metrics } from "./helpers.js";

describe("in-repo city rules", () => {
  it("loads the pad and loading-zone files shipped in .city/", () => {
    const building = parseBuildingRules(
      JSON.parse(readFileSync(".city/building.json", "utf8")) as unknown,
    );
    const zone = parseLoadingZoneRules(
      JSON.parse(readFileSync(".city/loading-zone.json", "utf8")) as unknown,
    );
    expect(building.plot).toBe("pad");
    expect(building.sizeFrom).toBe("stars");
    expect(building.bands.S.maxStarsExclusive).toBe(5000);
    expect(building.bands.L.ids).toEqual([35, 50]);
    expect(zone.plot).toBe("receiving-yard");
    expect(zone.precedence).toEqual(["openPrs", "openIssues", "recentActivity"]);
    expect(zone.props.prs).toEqual(["materials"]);
    expect(zone.props.highPrsOrBot).toEqual(["drone"]);
  });

  it("lists loading-zone props from the parser flags", () => {
    const lots = parseCity(
      [
        metrics({
          fullName: "acme/busy",
          openPrs: 20,
          openIssues: 2,
          pushedAt: "2026-09-10T00:00:00Z",
        }),
      ],
      { now: FIXED_NOW },
    );
    expect(yardPropList(lots[0])).toEqual(["blueprint", "materials", "crew", "drone"]);
  });

  it("rejects invented archetypes that are not part of this city", () => {
    expect(() => parseBuildingRules({ version: 1, plot: "tower" })).toThrow(/plot/);
    expect(() => parseLoadingZoneRules({ version: 1, plot: "helipad" })).toThrow(/receiving-yard/);
  });
});
