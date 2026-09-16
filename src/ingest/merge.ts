import type { MetricField, RepoMetrics } from "../types.js";

/** A refresh could not measure fields and no complete earlier values exist. */
export class IncompleteRefreshError extends Error {
  constructor(
    readonly fullName: string,
    readonly fields: MetricField[],
  ) {
    super(
      `Incomplete refresh for ${fullName}: ${fields.join(", ")} not measured and no last good values`,
    );
    this.name = "IncompleteRefreshError";
  }
}

export interface MergedMetrics {
  metrics: RepoMetrics;
  /** Fields whose values came from `previous`. */
  carried: MetricField[];
}

/**
 * Unknown fields never become zeros. Each field the fresh fetch failed to
 * measure keeps the last complete value; if no complete value exists, the
 * refresh is rejected so the previous lot stays published.
 */
export function mergeMetrics(
  previous: RepoMetrics | undefined,
  fresh: RepoMetrics,
): MergedMetrics {
  const unknown = fresh.unknownFields ?? [];
  if (unknown.length === 0)
    return { metrics: { ...fresh, unknownFields: [] }, carried: [] };
  const previousUnknown = new Set(previous?.unknownFields ?? []);
  const unresolved = unknown.filter(
    (field) => !previous || previousUnknown.has(field),
  );
  if (unresolved.length)
    throw new IncompleteRefreshError(fresh.fullName, unresolved);
  const merged: RepoMetrics = { ...fresh, unknownFields: [] };
  const source = previous as RepoMetrics;
  for (const field of unknown) {
    switch (field) {
      case "openIssues":
        merged.openIssues = source.openIssues;
        break;
      case "openPrs":
        merged.openPrs = source.openPrs;
        break;
      case "recentDefaultCommits":
        merged.recentDefaultCommits = source.recentDefaultCommits;
        break;
      case "recentAuthors":
        merged.recentAuthors = [...source.recentAuthors];
        break;
      case "prAuthors":
        merged.prAuthors = source.prAuthors.map((a) => ({ ...a }));
        break;
      case "languageBytes":
        merged.languageBytes = { ...source.languageBytes };
        break;
      case "sizeKb":
        merged.sizeKb = source.sizeKb;
        break;
    }
  }
  return { metrics: merged, carried: [...unknown] };
}
