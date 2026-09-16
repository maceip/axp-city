import type { BuildingBand, YardKind } from "../types.js";

/**
 * Optional in-repo city files. The parser remains the live source of truth
 * for GitHub-backed lots; these documents spell the same rules so a repo
 * can declare how its **building pad** and **loading zone** (receiving yard)
 * should be read.
 */

export class CityRulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CityRulesError";
  }
}

export interface BuildingBandRule {
  maxStarsExclusive?: number;
  ids: readonly [number, number];
}

export interface BuildingRules {
  version: 1;
  plot: "pad";
  sizeFrom: "stars";
  bands: Record<BuildingBand, BuildingBandRule>;
  quietWhen: "no-recent-activity";
  quietAlpha: number;
}

export type YardPropName =
  | "blueprint"
  | "drafting-table"
  | "materials"
  | "crew"
  | "drone";

export interface LoadingZoneRules {
  version: 1;
  plot: "receiving-yard";
  precedence: readonly ["openPrs", "openIssues", "recentActivity"];
  props: {
    issues: readonly YardPropName[];
    prs: readonly YardPropName[];
    recent: readonly YardPropName[];
    highPrsOrBot: readonly YardPropName[];
  };
  combinedBlueprint: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new CityRulesError(`${label} must be ${allowed.join(" | ")}`);
  }
  return value as T;
}

function expectIntPair(value: unknown, label: string): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((n) => typeof n !== "number" || !Number.isInteger(n))
  ) {
    throw new CityRulesError(`${label} must be [lo, hi] integers`);
  }
  const [lo, hi] = value as [number, number];
  if (lo < 1 || hi > 50 || lo > hi) {
    throw new CityRulesError(`${label} must sit inside 1–50`);
  }
  return [lo, hi];
}

function parseBand(raw: unknown, label: string, needMax: boolean): BuildingBandRule {
  if (!isObject(raw)) throw new CityRulesError(`${label} must be an object`);
  const ids = expectIntPair(raw.ids, `${label}.ids`);
  if (needMax) {
    if (typeof raw.maxStarsExclusive !== "number" || raw.maxStarsExclusive <= 0) {
      throw new CityRulesError(`${label}.maxStarsExclusive must be a positive number`);
    }
    return { maxStarsExclusive: raw.maxStarsExclusive, ids };
  }
  return { ids };
}

const PROP_NAMES: readonly YardPropName[] = [
  "blueprint",
  "drafting-table",
  "materials",
  "crew",
  "drone",
];

function parseProps(value: unknown, label: string): YardPropName[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CityRulesError(`${label} must be a non-empty array`);
  }
  return value.map((item, i) => expectString(item, PROP_NAMES, `${label}[${i}]`));
}

export function parseBuildingRules(raw: unknown): BuildingRules {
  if (!isObject(raw)) throw new CityRulesError("building rules must be an object");
  if (raw.version !== 1) throw new CityRulesError("building.version must be 1");
  expectString(raw.plot, ["pad"] as const, "building.plot");
  expectString(raw.sizeFrom, ["stars"] as const, "building.sizeFrom");
  if (!isObject(raw.bands)) throw new CityRulesError("building.bands must be an object");
  const quietAlpha = raw.quietAlpha;
  if (typeof quietAlpha !== "number" || quietAlpha <= 0 || quietAlpha > 1) {
    throw new CityRulesError("building.quietAlpha must be in (0, 1]");
  }
  return {
    version: 1,
    plot: "pad",
    sizeFrom: "stars",
    bands: {
      S: parseBand(raw.bands.S, "building.bands.S", true),
      M: parseBand(raw.bands.M, "building.bands.M", true),
      L: parseBand(raw.bands.L, "building.bands.L", false),
    },
    quietWhen: expectString(raw.quietWhen, ["no-recent-activity"] as const, "building.quietWhen"),
    quietAlpha,
  };
}

export function parseLoadingZoneRules(raw: unknown): LoadingZoneRules {
  if (!isObject(raw)) throw new CityRulesError("loading-zone rules must be an object");
  if (raw.version !== 1) throw new CityRulesError("loading-zone.version must be 1");
  expectString(raw.plot, ["receiving-yard"] as const, "loading-zone.plot");
  if (
    !Array.isArray(raw.precedence) ||
    raw.precedence[0] !== "openPrs" ||
    raw.precedence[1] !== "openIssues" ||
    raw.precedence[2] !== "recentActivity"
  ) {
    throw new CityRulesError(
      "loading-zone.precedence must be [openPrs, openIssues, recentActivity]",
    );
  }
  if (!isObject(raw.props)) throw new CityRulesError("loading-zone.props must be an object");
  if (raw.combinedBlueprint !== true) {
    throw new CityRulesError("loading-zone.combinedBlueprint must be true");
  }
  return {
    version: 1,
    plot: "receiving-yard",
    precedence: ["openPrs", "openIssues", "recentActivity"],
    props: {
      issues: parseProps(raw.props.issues, "loading-zone.props.issues"),
      prs: parseProps(raw.props.prs, "loading-zone.props.prs"),
      recent: parseProps(raw.props.recent, "loading-zone.props.recent"),
      highPrsOrBot: parseProps(raw.props.highPrsOrBot, "loading-zone.props.highPrsOrBot"),
    },
    combinedBlueprint: true,
  };
}

export function yardPropList(flags: {
  showBlueprint: boolean;
  showDraftingTable: boolean;
  showMaterials: boolean;
  showCrew: boolean;
  showDrone: boolean;
}): YardPropName[] {
  const out: YardPropName[] = [];
  if (flags.showBlueprint) out.push("blueprint");
  if (flags.showDraftingTable) out.push("drafting-table");
  if (flags.showMaterials) out.push("materials");
  if (flags.showCrew) out.push("crew");
  if (flags.showDrone) out.push("drone");
  return out;
}

export function yardLabel(yard: YardKind): string {
  return yard.replaceAll("_", " ");
}
