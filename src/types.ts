/**
 * Metric fields that a fetch can fail to measure. A field listed in
 * `unknownFields` holds a placeholder, never a measured zero.
 */
export type MetricField =
  | "openIssues"
  | "openPrs"
  | "recentDefaultCommits"
  | "recentAuthors"
  | "prAuthors"
  | "languageBytes"
  | "sizeKb";

export const METRIC_FIELDS: readonly MetricField[] = [
  "openIssues",
  "openPrs",
  "recentDefaultCommits",
  "recentAuthors",
  "prAuthors",
  "languageBytes",
  "sizeKb",
];

/** How author lists were gathered. Sampling caps are explicit, not hidden. */
export interface AuthorSample {
  /** Open pull requests inspected for authors (GraphQL 20, REST up to 100). */
  prAuthorsInspected: number;
  /** Default-branch commits inspected for in-window authors (GraphQL 15, REST 30). */
  recentCommitsInspected: number;
  /** True when every open PR and every in-window commit was inspected. */
  complete: boolean;
}

/** Normalized GitHub metrics for one repository. Parser input. */
export interface RepoMetrics {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  /** Open issues only (PRs already subtracted). */
  openIssues: number;
  openPrs: number;
  /** GitHub `diskUsage` in kilobytes. */
  sizeKb: number;
  languageBytes: Record<string, number>;
  primaryLanguage: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  /** Default-branch commits whose timestamp falls inside the activity window. */
  recentDefaultCommits: number;
  /** Authors of default-branch commits inside the activity window only. */
  recentAuthors: string[];
  prAuthors: Array<{ login: string; type: string }>;
  fetchedAt: string;
  source: "github-graphql" | "github-rest" | "fixture";
  /** GitHub numeric repository id; stable across renames and transfers. */
  repoId?: number | null;
  /** Repository visibility as reported by GitHub. Unknown when absent. */
  isPrivate?: boolean | null;
  /** Fields this fetch could not measure. Empty or absent means fully measured. */
  unknownFields?: MetricField[];
  authorSample?: AuthorSample;
}

export type BuildingBand = "S" | "M" | "L";

/** Which GitHub trending window placed this lot. Address stays if the window changes. */
export type TrendingCadence = "daily" | "weekly" | "monthly";

/** Stable per-repo yard dressing that is not a loading-zone prop. */
export type DressingProp = "tree" | "bush" | "planter" | "lamp" | "none";

/**
 * Yard / lot activity kind. PR state wins when both issues and PRs exist;
 * issue props are still added (combined yard). See `docs/PARSER.md`.
 */
export type YardKind =
  | "fully_dormant"
  | "idle_active"
  | "issues_quiet"
  | "issues_active"
  | "prs_quiet"
  | "prs_active";

/**
 * Who is working the lot, derived from account classification of authors in
 * the activity window. `human`: only human-looking accounts. `robot`: only
 * bot/automation accounts. `mixed`: both. `unknown`: recent activity but the
 * author data was not measured. `none`: no activity in the window.
 * Bot detection is a login/account-type heuristic, not proof of AI authorship.
 */
export type OccupantClass = "human" | "robot" | "mixed" | "unknown" | "none";

/** How much of the metric data behind a lot was actually measured. */
export interface LotFreshness {
  /** Fields carried over from the last complete refresh instead of measured. */
  carriedFields: MetricField[];
  /** When those carried values were last measured. */
  carriedFrom?: string;
}

export interface CityLot {
  fullName: string;
  owner: string;
  name: string;
  url: string;
  /** GitHub numeric repository id when known; the stable identity for renames. */
  repoId?: number | null;
  buildingBand: BuildingBand;
  /** Stable 1–50 id inside the band’s conceptual catalog. */
  buildingId: number;
  /**
   * Second hash channel: roof/wall tint so two lots that share a silhouette
   * still read as different houses. Stable per fullName; not neighbour-relative.
   */
  facadeTint: number;
  /** Extra plant/prop from the same hash; independent of loading-zone rules. */
  dressingProp: DressingProp;
  yard: YardKind;
  recentActivity: boolean;
  showBlueprint: boolean;
  showDraftingTable: boolean;
  showMaterials: boolean;
  showCrew: boolean;
  showDrone: boolean;
  botDetected: boolean;
  /** Ground crew class. Drones may still fly over human high-PR yards. */
  occupantClass: OccupantClass;
  /** Human-readable explanation of `occupantClass` for the inspect card and census. */
  crewBasis: string;
  stars: number;
  forks: number;
  openIssues: number;
  openPrs: number;
  sizeKb: number;
  primaryLanguage: string | null;
  quietAlpha?: number;
  rulesSource?: "default" | "repository";
  rulesWarning?: string;
  /** Validated version-2 rule extensions (artwork, layout, extra props). */
  artwork?: import("./rules/cityFiles.js").ApprovedArtwork;
  layout?: import("./rules/cityFiles.js").YardLayout;
  extraProps?: import("./rules/cityFiles.js").DecorPropName[];
  dataSource?: RepoMetrics["source"];
  fetchedAt?: string;
  /** Present when some fields were carried from an earlier complete refresh. */
  partial?: LotFreshness;
  /**
   * Trending City window that assigned this lot. Parser never invents it;
   * the trending sync stamps it. Refresh keeps the last value unless the
   * sync supplies a new one. Does not move the address.
   */
  cadence?: TrendingCadence;
}

export interface ParseOptions {
  /** Clock used for the activity window. Defaults to now. */
  now?: Date | string | number;
  recentDays?: number;
  rules?: import("./rules/cityFiles.js").CityRules;
  /** Fields carried from the last complete refresh (see `mergeMetrics`). */
  carried?: { fields: MetricField[]; from?: string };
  /** Set by Trending City enrollment, never derived from metrics. */
  cadence?: TrendingCadence;
}

export interface IngestSnapshot {
  fetchedAt: string;
  asOf: string;
  source: RepoMetrics["source"] | "mixed";
  repos: string[];
  metrics: RepoMetrics[];
}
