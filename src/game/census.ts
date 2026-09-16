import { yardLabel, yardPropList } from "../rules/cityFiles.js";
import type { BuildingBand, CityLot } from "../types.js";
import type { CityPlan, LotPlacement } from "../world/layout.js";
import { constructionState } from "./construction.js";

/**
 * The MASS bar reads the selected building's mass band: the same star-band
 * that chose the silhouette (S/M/L). It is a per-lot indicator, not a city
 * total, and it is empty when nothing is selected — the meaning carried by the
 * original HUD.
 */
export function massPercent(band: BuildingBand | undefined): number {
  return band === "L" ? 100 : band === "M" ? 64 : band === "S" ? 34 : 0;
}

export function crewLabel(lot: Pick<CityLot, "occupantClass">): string {
  switch (lot.occupantClass) {
    case "human":
      return "HUMAN CREW";
    case "robot":
      return "ROBOT CREW";
    case "mixed":
      return "MIXED CREW";
    case "unknown":
      return "CREW UNKNOWN";
    default:
      return "QUIET LOT";
  }
}

export interface CensusRow {
  repo: string;
  owner: string;
  name: string;
  district: string;
  stars: number;
  issues: number;
  prs: number;
  band: BuildingBand;
  crew: string;
  crewBasis: string;
  yard: string;
  props: string;
  constructing: boolean;
  partial: boolean;
  source: string;
  x: number;
  y: number;
}

export type CensusSortKey = "repo" | "stars" | "issues" | "prs" | "band" | "district";

export function censusRows(plan: CityPlan, now = Date.now()): CensusRow[] {
  return plan.placements.map((place) => censusRow(place, now));
}

export function censusRow(place: LotPlacement, now = Date.now()): CensusRow {
  const lot = place.lot;
  return {
    repo: lot.fullName,
    owner: lot.owner,
    name: lot.name,
    district: place.district,
    stars: lot.stars,
    issues: lot.openIssues,
    prs: lot.openPrs,
    band: lot.buildingBand,
    crew: crewLabel(lot),
    crewBasis: lot.crewBasis,
    yard: yardLabel(lot.yard),
    props: yardPropList(lot).concat(lot.extraProps ?? []).join(", ") || "—",
    constructing: constructionState(place, now).stage !== "complete",
    partial: Boolean(lot.partial?.carriedFields.length),
    source: lot.dataSource === "fixture" ? "fixture" : "github",
    x: place.x,
    y: place.y,
  };
}

const BAND_ORDER: Record<BuildingBand, number> = { S: 0, M: 1, L: 2 };

export function filterCensus(rows: CensusRow[], query: string): CensusRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      row.repo.toLowerCase().includes(q) ||
      row.district.toLowerCase().includes(q) ||
      row.crew.toLowerCase().includes(q) ||
      row.yard.toLowerCase().includes(q),
  );
}

export function sortCensus(
  rows: CensusRow[],
  key: CensusSortKey,
  descending: boolean,
): CensusRow[] {
  const sorted = [...rows].sort((a, b) => {
    switch (key) {
      case "stars":
      case "issues":
      case "prs":
        return a[key] - b[key];
      case "band":
        return BAND_ORDER[a.band] - BAND_ORDER[b.band];
      case "district":
        return a.district.localeCompare(b.district) || a.repo.localeCompare(b.repo);
      default:
        return a.repo.localeCompare(b.repo);
    }
  });
  return descending ? sorted.reverse() : sorted;
}

/** Case-insensitive lookup that also accepts a bare repository name. */
export function findPlacement(
  plan: CityPlan,
  query: string,
): LotPlacement | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    plan.placements.find((p) => p.lot.fullName.toLowerCase() === q) ??
    plan.placements.find((p) => p.lot.name.toLowerCase() === q) ??
    plan.placements.find((p) => p.lot.fullName.toLowerCase().includes(q))
  );
}
