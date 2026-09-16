import { DEFAULT_RULES } from "../rules/cityFiles.js";
import type {
  BuildingBand,
  CityLot,
  OccupantClass,
  ParseOptions,
  RepoMetrics,
  YardKind,
} from "../types.js";
import {
  BUILDING_ID_LARGE,
  BUILDING_ID_MEDIUM,
  BUILDING_ID_SMALL,
  HIGH_PR_COUNT,
  KNOWN_BOT_LOGINS,
  RECENT_ACTIVITY_DAYS,
  STAR_BAND_MEDIUM_MAX,
  STAR_BAND_SMALL_MAX,
} from "./thresholds.js";

const MS_PER_DAY = 86_400_000;

export function buildingBandFromStars(stars: number): BuildingBand {
  if (stars >= STAR_BAND_MEDIUM_MAX) return "L";
  if (stars >= STAR_BAND_SMALL_MAX) return "M";
  return "S";
}

export function buildingIdRange(band: BuildingBand): readonly [number, number] {
  if (band === "L") return BUILDING_ID_LARGE;
  if (band === "M") return BUILDING_ID_MEDIUM;
  return BUILDING_ID_SMALL;
}

/** Stable FNV-1a so the same repo always gets the same silhouette. */
export function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickBuildingId(fullName: string, band: BuildingBand): number {
  const [lo, hi] = buildingIdRange(band);
  const span = hi - lo + 1;
  return lo + (stableHash(fullName.toLowerCase()) % span);
}

export function isBotLogin(login: string, type?: string): boolean {
  if (type === "Bot") return true;
  const folded = login.trim().toLowerCase();
  if (!folded) return false;
  if (KNOWN_BOT_LOGINS.includes(folded as (typeof KNOWN_BOT_LOGINS)[number])) {
    return true;
  }
  if (folded.includes("[bot]")) return true;
  if (folded.endsWith("-bot")) return true;
  return false;
}

export function detectBot(metrics: RepoMetrics): boolean {
  if (metrics.prAuthors.some((a) => isBotLogin(a.login, a.type))) return true;
  return metrics.recentAuthors.some((login) => isBotLogin(login));
}

export function hasRecentActivity(
  metrics: RepoMetrics,
  options: ParseOptions = {},
): boolean {
  const days = options.recentDays ?? RECENT_ACTIVITY_DAYS;
  const now = new Date(options.now ?? Date.now()).getTime();
  const cutoff = now - days * MS_PER_DAY;

  if (metrics.recentDefaultCommits > 0) return true;
  if (!metrics.pushedAt) return false;
  const pushed = Date.parse(metrics.pushedAt);
  if (Number.isNaN(pushed)) return false;
  return pushed >= cutoff;
}

/**
 * Map repo metrics → one city lot (building pad + receiving yard).
 *
 * Decision order (see docs/PARSER.md):
 *   1. openPrs > 0            → prs_quiet | prs_active
 *      + blueprint if issues also exist (combined yard)
 *   2. else openIssues > 0    → issues_quiet | issues_active
 *   3. else recent activity   → idle_active (empty yard, live building)
 *   4. else                   → fully_dormant
 */
export function parseLot(
  metrics: RepoMetrics,
  options: ParseOptions = {},
): CityLot {
  const recentActivity = hasRecentActivity(metrics, options);
  const botDetected = detectBot(metrics);
  const rules = options.rules ?? DEFAULT_RULES;
  const band: BuildingBand =
    metrics.stars < rules.building.bands.S.maxStarsExclusive!
      ? "S"
      : metrics.stars < rules.building.bands.M.maxStarsExclusive!
        ? "M"
        : "L";
  const [lo, hi] = rules.building.bands[band].ids;
  const buildingId =
    rules.building.buildingId ??
    lo + (stableHash(metrics.fullName.toLowerCase()) % (hi - lo + 1));

  const hasPrs = metrics.openPrs > 0;
  const hasIssues = metrics.openIssues > 0;

  let yard: YardKind;
  let showBlueprint = false;
  let showDraftingTable = false;
  let showMaterials = false;
  let showCrew = false;

  if (hasPrs) {
    yard = recentActivity ? "prs_active" : "prs_quiet";
    showMaterials = true;
    showCrew = recentActivity;
    if (hasIssues) showBlueprint = true;
  } else if (hasIssues) {
    yard = recentActivity ? "issues_active" : "issues_quiet";
    showBlueprint = true;
    showDraftingTable = true;
    showCrew = recentActivity;
  } else if (recentActivity) {
    yard = "idle_active";
  } else {
    yard = "fully_dormant";
  }

  const props = new Set<string>();
  if (hasPrs) for (const prop of rules.loadingZone.props.prs) props.add(prop);
  else if (hasIssues)
    for (const prop of rules.loadingZone.props.issues) props.add(prop);
  if (hasPrs && hasIssues && rules.loadingZone.combinedBlueprint)
    props.add("blueprint");
  if (recentActivity && (hasPrs || hasIssues))
    for (const prop of rules.loadingZone.props.recent) props.add(prop);
  if (hasPrs && (metrics.openPrs >= HIGH_PR_COUNT || botDetected))
    for (const prop of rules.loadingZone.props.highPrsOrBot) props.add(prop);
  showBlueprint = props.has("blueprint");
  showDraftingTable = props.has("drafting-table");
  showMaterials = props.has("materials");
  showCrew = props.has("crew");
  const showDrone = props.has("drone");
  const occupantClass = occupantFor(
    recentActivity,
    botDetected,
    showCrew,
    showDrone,
  );

  return {
    fullName: metrics.fullName,
    owner: metrics.owner,
    name: metrics.name,
    url: metrics.url,
    buildingBand: band,
    buildingId,
    yard,
    recentActivity,
    showBlueprint,
    showDraftingTable,
    showMaterials,
    showCrew,
    showDrone,
    botDetected,
    occupantClass,
    stars: metrics.stars,
    forks: metrics.forks,
    openIssues: metrics.openIssues,
    openPrs: metrics.openPrs,
    sizeKb: metrics.sizeKb,
    primaryLanguage: metrics.primaryLanguage,
    quietAlpha: rules.building.quietAlpha,
    dataSource: metrics.source,
    fetchedAt: metrics.fetchedAt,
  };
}

/**
 * Humans work recent human yards. Robots/drones work bot-authored yards.
 * Stale high-PR human yards keep a parked drone but no sidewalk crew.
 */
export function occupantFor(
  recentActivity: boolean,
  botDetected: boolean,
  _showCrew: boolean,
  showDrone: boolean,
): OccupantClass {
  if (botDetected && (recentActivity || showDrone)) return "robot";
  if (recentActivity) return "human";
  return "none";
}

/** Avoid two lots in the same scene sharing a silhouette when the band allows it. */
export function uniquifyBuildingIds(lots: CityLot[]): CityLot[] {
  const used = new Set<number>();
  return lots.map((lot) => {
    const [lo, hi] = buildingIdRange(lot.buildingBand);
    let id = lot.buildingId;
    let guard = 0;
    while (used.has(id) && guard < hi - lo + 1) {
      id = id >= hi ? lo : id + 1;
      guard += 1;
    }
    used.add(id);
    return id === lot.buildingId ? lot : { ...lot, buildingId: id };
  });
}

export function parseCity(
  metrics: RepoMetrics[],
  options: ParseOptions = {},
): CityLot[] {
  return metrics.map((row) => parseLot(row, options));
}
