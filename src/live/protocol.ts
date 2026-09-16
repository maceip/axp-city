import type { CityPlan, LotPlacement } from "../world/layout.js";

/**
 * Wire schema. `version` stays 1 so clients already open during an upgrade
 * keep decoding events; new fields are additive and `schema` names the exact
 * snapshot/layout contract for clients that validate it.
 */
export const SNAPSHOT_SCHEMA = 2;

export type CityMode = "live" | "offline";

/** Freshness is separate from connection state: connected ≠ fresh. */
export interface CityFreshness {
  /** Last time any repository refresh completed with measured data. */
  lastSuccessfulRefreshAt: string | null;
  /** Last refresh failure (any repository) and its message. */
  lastFailureAt: string | null;
  lastError: string | null;
  /** Refreshes are considered stale after this many milliseconds. */
  staleAfterMs: number;
  /** Repositories whose last refresh failed. */
  failingRepositories: number;
  /** How GitHub data arrives: events, polling, or recorded fixtures. */
  source: "github-app" | "github-token" | "github-anonymous" | "fixture";
}

export interface CitySnapshot {
  version: 1;
  schema: { snapshot: typeof SNAPSHOT_SCHEMA; layout: number };
  revision: number;
  serverTime: string;
  mode: CityMode;
  plan: CityPlan;
  freshness: CityFreshness;
}

interface MutationBase {
  revision: number;
  serverTime: string;
}

export interface LotAddedMutation extends MutationBase {
  type: "lot_added";
  placement: LotPlacement;
  geometry: Omit<CityPlan, "placements">;
}

export interface LotUpdatedMutation extends MutationBase {
  type: "lot_updated";
  placement: LotPlacement;
}

export interface LotRenamedMutation extends MutationBase {
  type: "lot_renamed";
  previousFullName: string;
  placement: LotPlacement;
}

export interface LotRemovedMutation extends MutationBase {
  type: "lot_removed";
  fullName: string;
  reason: string;
  geometry: Omit<CityPlan, "placements">;
}

export type CityMutation =
  | LotAddedMutation
  | LotUpdatedMutation
  | LotRenamedMutation
  | LotRemovedMutation;

/** Non-revisioned status broadcast (freshness changes, reconcile passes). */
export interface CityStatusEvent {
  type: "status";
  serverTime: string;
  freshness: CityFreshness;
}

export const MUTATION_TYPES: readonly CityMutation["type"][] = [
  "lot_added",
  "lot_updated",
  "lot_renamed",
  "lot_removed",
];
