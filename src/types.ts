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
  recentAuthors: string[];
  prAuthors: Array<{ login: string; type: string }>;
  fetchedAt: string;
  source: "github-graphql" | "github-rest" | "fixture";
}

export type BuildingBand = "S" | "M" | "L";

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

/** Who is working the lot. Humans for human activity; robots/drones for AI. */
export type OccupantClass = "human" | "robot" | "none";

export interface CityLot {
  fullName: string;
  owner: string;
  name: string;
  url: string;
  buildingBand: BuildingBand;
  /** Stable 1–50 id inside the band’s conceptual catalog. */
  buildingId: number;
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
  stars: number;
  forks: number;
  openIssues: number;
  openPrs: number;
  sizeKb: number;
  primaryLanguage: string | null;
}

export interface ParseOptions {
  /** Clock used for the activity window. Defaults to now. */
  now?: Date | string | number;
  recentDays?: number;
}

export interface IngestSnapshot {
  fetchedAt: string;
  asOf: string;
  source: RepoMetrics["source"] | "mixed";
  repos: string[];
  metrics: RepoMetrics[];
}
