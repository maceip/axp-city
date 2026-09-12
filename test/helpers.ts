import type { RepoMetrics } from "../src/types.js";

export const FIXED_NOW = "2026-09-11T12:00:00.000Z";

export function metrics(partial: Partial<RepoMetrics> = {}): RepoMetrics {
  return {
    owner: "acme",
    name: "widget",
    fullName: "acme/widget",
    url: "https://github.com/acme/widget",
    description: "test fixture",
    stars: 100,
    forks: 10,
    openIssues: 0,
    openPrs: 0,
    sizeKb: 1200,
    languageBytes: { TypeScript: 80_000 },
    primaryLanguage: "TypeScript",
    pushedAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    recentDefaultCommits: 0,
    recentAuthors: [],
    prAuthors: [],
    fetchedAt: FIXED_NOW,
    source: "fixture",
    ...partial,
  };
}
