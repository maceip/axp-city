import { DEFAULT_RULES, type CityRules } from "../rules/cityFiles.js";
import type {
  BuildingBand,
  CityLot,
  MetricField,
  OccupantClass,
  ParseOptions,
  RepoMetrics,
  YardKind,
} from "../types.js";
import {
  HIGH_PR_COUNT,
  KNOWN_BOT_LOGINS,
  RECENT_ACTIVITY_DAYS,
} from "./thresholds.js";

const MS_PER_DAY = 86_400_000;

/** Stable FNV-1a so the same repo always gets the same silhouette. */
export function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

export interface AuthorClassification {
  humans: string[];
  bots: string[];
  /** Author data was not measured in this refresh. */
  unknown: boolean;
}

/**
 * Split in-window commit authors and open-PR authors into human-looking and
 * automation accounts. Sampling and unknown fields are reported, not hidden.
 */
export function classifyAuthors(metrics: RepoMetrics): AuthorClassification {
  const unknownFields = new Set<MetricField>(metrics.unknownFields ?? []);
  const humans = new Set<string>();
  const bots = new Set<string>();
  for (const author of metrics.prAuthors)
    (isBotLogin(author.login, author.type) ? bots : humans).add(author.login);
  for (const login of metrics.recentAuthors)
    (isBotLogin(login) ? bots : humans).add(login);
  return {
    humans: [...humans],
    bots: [...bots],
    unknown:
      unknownFields.has("prAuthors") || unknownFields.has("recentAuthors"),
  };
}

export function detectBot(metrics: RepoMetrics): boolean {
  return classifyAuthors(metrics).bots.length > 0;
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
 * Crew class and its written justification. The label is what the inspect
 * card and census show, so the meaning is explicit rather than implied by art.
 */
export function classifyCrew(
  metrics: RepoMetrics,
  recentActivity: boolean,
  showDrone: boolean,
  options: ParseOptions = {},
): { occupantClass: OccupantClass; crewBasis: string } {
  const days = options.recentDays ?? RECENT_ACTIVITY_DAYS;
  const authors = classifyAuthors(metrics);
  const sample = metrics.authorSample;
  const sampled =
    sample && !sample.complete
      ? ` Author sample: ${sample.recentCommitsInspected} in-window commits and ${sample.prAuthorsInspected} open PRs inspected; more exist.`
      : "";
  if (!recentActivity) {
    if (authors.bots.length && showDrone)
      return {
        occupantClass: "robot",
        crewBasis: `Automation accounts (${authors.bots.join(", ")}) hold open pull requests; no default-branch activity in ${days} days, so only the parked drone remains.${sampled}`,
      };
    return {
      occupantClass: "none",
      crewBasis: `No default-branch push or commit in the last ${days} days.`,
    };
  }
  if (authors.unknown && !authors.bots.length && !authors.humans.length)
    return {
      occupantClass: "unknown",
      crewBasis: `Recent activity in the last ${days} days, but author data was not available in the last refresh; the crew type is not known.`,
    };
  if (authors.bots.length && authors.humans.length)
    return {
      occupantClass: "mixed",
      crewBasis: `Both human accounts (${authors.humans.length}) and automation accounts (${authors.bots.join(", ")}) authored commits or open PRs in the last ${days} days.${sampled}`,
    };
  if (authors.bots.length)
    return {
      occupantClass: "robot",
      crewBasis: `Only automation accounts (${authors.bots.join(", ")}) appear among in-window commit and open-PR authors. Detection is a login/account-type heuristic, not proof of machine-written code.${sampled}`,
    };
  if (authors.humans.length)
    return {
      occupantClass: "human",
      crewBasis: `Only human-looking accounts (${authors.humans.length}) appear among in-window commit and open-PR authors. Absence of a detected bot is not proof of exclusively human work.${sampled}`,
    };
  return {
    occupantClass: "human",
    crewBasis: `Recent push or commits in the last ${days} days with no sampled authors; treated as a human crew by default.${sampled}`,
  };
}

/** Star band from the active rules; `DEFAULT_RULES` is the only default source. */
export function buildingBandFromStars(
  stars: number,
  rules: CityRules = DEFAULT_RULES,
): BuildingBand {
  return stars < rules.building.bands.S.maxStarsExclusive!
    ? "S"
    : stars < rules.building.bands.M.maxStarsExclusive!
      ? "M"
      : "L";
}

/**
 * Silhouette selection policy: an explicit repository `buildingId` wins;
 * otherwise a stable hash of the repository name picks inside the band's
 * catalog range. Neighbouring repositories may share a silhouette — stable
 * appearance across refreshes and restarts is preferred over enforced
 * uniqueness, which would make a lot's look depend on its neighbours.
 */
export function pickBuildingId(
  fullName: string,
  band: BuildingBand,
  rules: CityRules = DEFAULT_RULES,
): number {
  const [lo, hi] = rules.building.bands[band].ids;
  return (
    rules.building.buildingId ??
    lo + (stableHash(fullName.toLowerCase()) % (hi - lo + 1))
  );
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
  const band = buildingBandFromStars(metrics.stars, rules);
  const buildingId = pickBuildingId(metrics.fullName, band, rules);

  const hasPrs = metrics.openPrs > 0;
  const hasIssues = metrics.openIssues > 0;

  let yard: YardKind;
  if (hasPrs) yard = recentActivity ? "prs_active" : "prs_quiet";
  else if (hasIssues) yard = recentActivity ? "issues_active" : "issues_quiet";
  else if (recentActivity) yard = "idle_active";
  else yard = "fully_dormant";

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
  const showBlueprint = props.has("blueprint");
  const showDraftingTable = props.has("drafting-table");
  const showMaterials = props.has("materials");
  const showCrew = props.has("crew");
  const showDrone = props.has("drone");
  const extraProps = [...props].filter(
    (prop): prop is import("../rules/cityFiles.js").DecorPropName =>
      !["blueprint", "drafting-table", "materials", "crew", "drone"].includes(
        prop,
      ),
  );
  const crew = classifyCrew(metrics, recentActivity, showDrone, options);

  const lot: CityLot = {
    fullName: metrics.fullName,
    owner: metrics.owner,
    name: metrics.name,
    url: metrics.url,
    repoId: metrics.repoId ?? null,
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
    occupantClass: crew.occupantClass,
    crewBasis: crew.crewBasis,
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
  // A declared artwork rule is only a request; `resolveRepository` attaches
  // verified, operator-approved artwork. Layouts are validated at parse time.
  if (rules.loadingZone.layout) lot.layout = rules.loadingZone.layout;
  if (extraProps.length) lot.extraProps = extraProps;
  if (options.carried?.fields.length)
    lot.partial = {
      carriedFields: [...options.carried.fields],
      carriedFrom: options.carried.from,
    };
  return lot;
}

export function parseCity(
  metrics: RepoMetrics[],
  options: ParseOptions = {},
): CityLot[] {
  return metrics.map((row) => parseLot(row, options));
}
