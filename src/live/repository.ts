import { join } from "node:path";
import {
  fetchRepoMetrics,
  RepositoryUnavailableError,
} from "../ingest/github.js";
import { mergeMetrics } from "../ingest/merge.js";
import { parseLot } from "../parser/parseLot.js";
import {
  loadArtworkApprovals,
  resolveArtwork,
  type ArtworkApprovals,
} from "../rules/artwork.js";
import {
  loadLocalRules,
  loadRepositoryRules,
  repoName,
} from "../rules/load.js";
import type { CityRules } from "../rules/cityFiles.js";
import type { CityLot, RepoMetrics } from "../types.js";

export { RepositoryUnavailableError } from "../ingest/github.js";
export { IncompleteRefreshError } from "../ingest/merge.js";

export interface ResolvedRepository {
  lot: CityLot;
  /** Metrics after carrying last good values; stored as the new baseline. */
  metrics: RepoMetrics;
}

export interface ResolveOptions {
  rulesDir?: string;
  token?: string;
  /** Last complete metrics for this repository, used to fill unknown fields. */
  previous?: RepoMetrics;
  approvals?: ArtworkApprovals;
  artworkCacheDir?: string;
  request?: typeof fetch;
  now?: Date;
  defaults?: CityRules;
}

/** A repository whose visibility is private (or unknown) is never published. */
export class PrivateRepositoryError extends Error {
  constructor(readonly fullName: string) {
    super(`Repository ${fullName} is not public and cannot be published`);
    this.name = "PrivateRepositoryError";
  }
}

/**
 * One canonical path from GitHub to a lot. Everything the live server,
 * enrollment, and export share funnels through here so no code path can
 * produce a different building or crew for the same repository.
 */
export async function resolveRepository(
  fullName: string,
  options: ResolveOptions | string = {},
  legacyToken?: string,
): Promise<ResolvedRepository> {
  const opts: ResolveOptions =
    typeof options === "string"
      ? { rulesDir: options, token: legacyToken }
      : options;
  repoName(fullName);
  const rulesDir = opts.rulesDir ?? ".city";
  const token = opts.token ?? process.env.GITHUB_TOKEN;
  const [owner, name] = fullName.split("/");
  const defaults = opts.defaults ?? (await loadLocalRules(rulesDir));
  const [fetched, configuration] = await Promise.all([
    fetchRepoMetrics([{ owner, name }], {
      token,
      request: opts.request,
      now: opts.now,
    }),
    loadRepositoryRules(fullName, defaults, token, opts.request),
  ]);
  const fresh = fetched[0];
  if (fresh.isPrivate !== false) throw new PrivateRepositoryError(fresh.fullName);
  const merged = mergeMetrics(opts.previous, fresh);
  const lot: CityLot = {
    ...parseLot(merged.metrics, {
      rules: configuration.rules,
      now: opts.now,
      carried: merged.carried.length
        ? { fields: merged.carried, from: opts.previous?.fetchedAt }
        : undefined,
    }),
    rulesSource: configuration.source,
  };
  const warnings = configuration.warning ? [configuration.warning] : [];
  const artworkRule = configuration.rules.building.artwork;
  if (artworkRule) {
    const approvals = opts.approvals ?? (await loadArtworkApprovals(rulesDir));
    const resolved = await resolveArtwork(
      fresh.fullName,
      artworkRule,
      approvals,
      opts.artworkCacheDir ?? join("data", "artwork"),
      token,
      opts.request,
    );
    if (resolved.artwork) lot.artwork = resolved.artwork;
    if (resolved.warning) warnings.push(resolved.warning);
  }
  if (warnings.length) lot.rulesWarning = warnings.join("; ");
  return { lot, metrics: merged.metrics };
}

/** Classify a refresh failure for the store: withdraw, keep, or ignore. */
export function refreshFailureKind(
  error: unknown,
): "withdraw" | "transient" | "incomplete" {
  if (error instanceof RepositoryUnavailableError) return "withdraw";
  if (error instanceof PrivateRepositoryError) return "withdraw";
  if ((error as Error)?.name === "IncompleteRefreshError") return "incomplete";
  return "transient";
}
