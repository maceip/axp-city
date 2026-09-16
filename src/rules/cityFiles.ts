import type { BuildingBand, YardKind } from "../types.js";

export class CityRulesError extends Error {}
export type YardPropName =
  | "blueprint"
  | "drafting-table"
  | "materials"
  | "crew"
  | "drone";
export interface BuildingRules {
  version: 1;
  plot: "pad";
  sizeFrom: "stars";
  bands: Record<
    BuildingBand,
    { maxStarsExclusive?: number; ids: readonly [number, number] }
  >;
  quietWhen: "no-recent-activity";
  quietAlpha: number;
  buildingId?: number;
}
export interface LoadingZoneRules {
  version: 1;
  plot: "receiving-yard";
  precedence: readonly ["openPrs", "openIssues", "recentActivity"];
  props: Record<
    "issues" | "prs" | "recent" | "highPrsOrBot",
    readonly YardPropName[]
  >;
  combinedBlueprint: boolean;
}
export interface CityRules {
  building: BuildingRules;
  loadingZone: LoadingZoneRules;
}
export const DEFAULT_RULES: CityRules = {
  building: {
    version: 1,
    plot: "pad",
    sizeFrom: "stars",
    bands: {
      S: { maxStarsExclusive: 5000, ids: [1, 17] },
      M: { maxStarsExclusive: 20000, ids: [18, 34] },
      L: { ids: [35, 50] },
    },
    quietWhen: "no-recent-activity",
    quietAlpha: 0.62,
  },
  loadingZone: {
    version: 1,
    plot: "receiving-yard",
    precedence: ["openPrs", "openIssues", "recentActivity"],
    props: {
      issues: ["blueprint", "drafting-table"],
      prs: ["materials"],
      recent: ["crew"],
      highPrsOrBot: ["drone"],
    },
    combinedBlueprint: true,
  },
};
function object(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new CityRulesError(`${label} must be an object`);
  return raw as Record<string, unknown>;
}
function keys(
  raw: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  for (const key of Object.keys(raw))
    if (!allowed.includes(key))
      throw new CityRulesError(`Unknown ${label}.${key}`);
}
export function parseBuildingRules(
  raw: unknown,
  base = DEFAULT_RULES.building,
): BuildingRules {
  const input = object(raw, "building");
  keys(
    input,
    [
      "version",
      "plot",
      "sizeFrom",
      "bands",
      "quietWhen",
      "quietAlpha",
      "buildingId",
    ],
    "building",
  );
  const r = { ...base, ...input } as BuildingRules;
  if (
    r.version !== 1 ||
    r.plot !== "pad" ||
    r.sizeFrom !== "stars" ||
    r.quietWhen !== "no-recent-activity"
  )
    throw new CityRulesError(
      "building version/plot/sizeFrom/quietWhen is invalid",
    );
  if (!Number.isFinite(r.quietAlpha) || r.quietAlpha <= 0 || r.quietAlpha > 1)
    throw new CityRulesError("quietAlpha must be in (0,1]");
  if (
    r.buildingId !== undefined &&
    (!Number.isInteger(r.buildingId) || r.buildingId < 1 || r.buildingId > 50)
  )
    throw new CityRulesError("buildingId must be in 1–50");
  const bands = object(input.bands ?? {}, "bands");
  keys(bands, ["S", "M", "L"], "bands");
  r.bands = { ...base.bands };
  for (const band of ["S", "M", "L"] as const) {
    const patch = object(bands[band] ?? {}, band);
    keys(patch, ["ids", "maxStarsExclusive"], band);
    const b = { ...base.bands[band], ...patch } as BuildingRules["bands"]["S"];
    if (
      !Array.isArray(b.ids) ||
      b.ids.length !== 2 ||
      b.ids.some((n) => !Number.isInteger(n) || n < 1 || n > 50) ||
      b.ids[0] > b.ids[1]
    )
      throw new CityRulesError(
        `${band}.ids must be an inclusive range in 1–50`,
      );
    if (
      band !== "L" &&
      (!Number.isFinite(b.maxStarsExclusive) || b.maxStarsExclusive! <= 0)
    )
      throw new CityRulesError(`${band}.maxStarsExclusive must be positive`);
    r.bands[band] = b;
  }
  if (r.bands.S.maxStarsExclusive! >= r.bands.M.maxStarsExclusive!)
    throw new CityRulesError("Star thresholds must increase");
  return r;
}
export function parseLoadingZoneRules(
  raw: unknown,
  base = DEFAULT_RULES.loadingZone,
): LoadingZoneRules {
  const input = object(raw, "loading-zone");
  keys(
    input,
    ["version", "plot", "precedence", "props", "combinedBlueprint"],
    "loading-zone",
  );
  const r = { ...base, ...input } as LoadingZoneRules;
  if (r.version !== 1 || r.plot !== "receiving-yard")
    throw new CityRulesError("loading-zone must be version 1 / receiving-yard");
  if (
    JSON.stringify(r.precedence) !==
    JSON.stringify(DEFAULT_RULES.loadingZone.precedence)
  )
    throw new CityRulesError(
      "precedence must be openPrs, openIssues, recentActivity",
    );
  if (typeof r.combinedBlueprint !== "boolean")
    throw new CityRulesError("combinedBlueprint must be boolean");
  const props = object(input.props ?? {}, "props");
  keys(props, ["issues", "prs", "recent", "highPrsOrBot"], "props");
  r.props = { ...base.props, ...props };
  const names = ["blueprint", "drafting-table", "materials", "crew", "drone"];
  for (const value of Object.values(r.props))
    if (!Array.isArray(value) || value.some((v) => !names.includes(v)))
      throw new CityRulesError("Invalid loading-zone prop");
  return r;
}
export function yardPropList(flags: {
  showBlueprint: boolean;
  showDraftingTable: boolean;
  showMaterials: boolean;
  showCrew: boolean;
  showDrone: boolean;
}): YardPropName[] {
  const pairs = [
    ["showBlueprint", "blueprint"],
    ["showDraftingTable", "drafting-table"],
    ["showMaterials", "materials"],
    ["showCrew", "crew"],
    ["showDrone", "drone"],
  ] as const;
  return pairs.filter(([key]) => flags[key]).map(([, value]) => value);
}
export function yardLabel(yard: YardKind): string {
  return yard.replaceAll("_", " ");
}
