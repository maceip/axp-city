import type { AuthorSample, MetricField, RepoMetrics } from "../types.js";

export interface GraphQlRepository {
  nameWithOwner: string;
  url: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  diskUsage: number | null;
  pushedAt: string | null;
  updatedAt: string | null;
  databaseId?: number | null;
  isPrivate?: boolean | null;
  primaryLanguage: { name: string } | null;
  languages?: {
    edges?: Array<{ size: number; node: { name: string } } | null> | null;
  } | null;
  issues?: { totalCount: number } | null;
  pullRequests?: { totalCount: number } | null;
  defaultBranchRef?: {
    target?: {
      recentCount?: { totalCount: number } | null;
      recent?: {
        nodes?: Array<{
          committedDate: string;
          authors?: {
            nodes?: Array<{
              name?: string | null;
              user?: { login: string } | null;
            } | null> | null;
          } | null;
        } | null> | null;
      } | null;
    } | null;
  } | null;
  openPrAuthors?: {
    nodes?: Array<{
      author?: { login?: string | null; __typename?: string } | null;
    } | null> | null;
  } | null;
}

export interface RestRepo {
  id?: number;
  private?: boolean;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  pushed_at: string | null;
  updated_at: string | null;
  language: string | null;
}

/** GraphQL sampling caps used by the ingest query. */
export const GRAPHQL_PR_AUTHOR_SAMPLE = 20;
export const GRAPHQL_COMMIT_SAMPLE = 15;
/** REST sampling caps. */
export const REST_PR_AUTHOR_SAMPLE = 100;
export const REST_COMMIT_SAMPLE = 30;

function splitFullName(fullName: string): { owner: string; name: string } {
  const [owner, ...rest] = fullName.split("/");
  return { owner: owner ?? "", name: rest.join("/") };
}

function languageMap(
  edges: GraphQlRepository["languages"],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const edge of edges?.edges ?? []) {
    if (!edge) continue;
    out[edge.node.name] = edge.size;
  }
  return out;
}

/**
 * Authors of default-branch commits inside the activity window only. The
 * history sample is the latest N commits regardless of date, so commits older
 * than `since` are dropped here rather than letting a 2020 author drive today's
 * crew.
 */
function recentAuthors(
  repo: GraphQlRepository,
  since: string | undefined,
): { authors: string[]; inspected: number } {
  const seen = new Set<string>();
  const cutoff = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  const nodes = repo.defaultBranchRef?.target?.recent?.nodes ?? [];
  let inspected = 0;
  for (const node of nodes) {
    if (!node) continue;
    const at = Date.parse(node.committedDate);
    if (Number.isNaN(at) || at < cutoff) continue;
    inspected++;
    for (const author of node.authors?.nodes ?? []) {
      const login = author?.user?.login ?? author?.name;
      if (login) seen.add(login);
    }
  }
  return { authors: [...seen], inspected };
}

function prAuthors(
  repo: GraphQlRepository,
): Array<{ login: string; type: string }> {
  const out: Array<{ login: string; type: string }> = [];
  for (const node of repo.openPrAuthors?.nodes ?? []) {
    const login = node?.author?.login;
    if (!login) continue;
    out.push({
      login,
      type: node?.author?.__typename === "Bot" ? "Bot" : "User",
    });
  }
  return out;
}

export interface GraphQlNormalizeOptions {
  /** Activity-window start (ISO). Authors of older commits are excluded. */
  since?: string;
  /**
   * Field paths under this repository alias that GraphQL reported errors for,
   * e.g. `issues`, `defaultBranchRef.target.recent`. Those fields are unknown,
   * not zero.
   */
  erroredPaths?: Iterable<string>;
}

export function fromGraphQl(
  repo: GraphQlRepository,
  fetchedAt: string,
  options: GraphQlNormalizeOptions = {},
): RepoMetrics {
  const { owner, name } = splitFullName(repo.nameWithOwner);
  const errored = new Set(options.erroredPaths ?? []);
  const failed = (prefix: string) =>
    [...errored].some((p) => p === prefix || p.startsWith(`${prefix}.`));
  const unknown = new Set<MetricField>();
  if (repo.issues == null || failed("issues")) unknown.add("openIssues");
  if (repo.pullRequests == null || failed("pullRequests"))
    unknown.add("openPrs");
  if (repo.diskUsage == null || failed("diskUsage")) unknown.add("sizeKb");
  if (repo.languages == null || failed("languages"))
    unknown.add("languageBytes");
  if (repo.openPrAuthors == null || failed("openPrAuthors"))
    unknown.add("prAuthors");
  // A repository without a default branch has measured zero commits; only a
  // reported error makes the history unknown.
  const historyFailed = failed("defaultBranchRef");
  const target = repo.defaultBranchRef?.target;
  if (historyFailed || (repo.defaultBranchRef && target?.recentCount == null))
    unknown.add("recentDefaultCommits");
  if (historyFailed || (repo.defaultBranchRef && target?.recent == null))
    unknown.add("recentAuthors");
  const recent = recentAuthors(repo, options.since);
  const openPrs = repo.pullRequests?.totalCount ?? 0;
  const recentCount = target?.recentCount?.totalCount ?? 0;
  const authorSample: AuthorSample = {
    prAuthorsInspected: Math.min(GRAPHQL_PR_AUTHOR_SAMPLE, openPrs),
    recentCommitsInspected: recent.inspected,
    complete:
      !unknown.has("prAuthors") &&
      !unknown.has("recentAuthors") &&
      openPrs <= GRAPHQL_PR_AUTHOR_SAMPLE &&
      recentCount <= GRAPHQL_COMMIT_SAMPLE,
  };
  return {
    owner,
    name,
    fullName: repo.nameWithOwner,
    url: repo.url,
    description: repo.description,
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    openIssues: repo.issues?.totalCount ?? 0,
    openPrs,
    sizeKb: repo.diskUsage ?? 0,
    languageBytes: languageMap(repo.languages),
    primaryLanguage: repo.primaryLanguage?.name ?? null,
    pushedAt: repo.pushedAt,
    updatedAt: repo.updatedAt,
    recentDefaultCommits: recentCount,
    recentAuthors: recent.authors,
    prAuthors: prAuthors(repo),
    fetchedAt,
    source: "github-graphql",
    repoId: repo.databaseId ?? null,
    isPrivate: repo.isPrivate ?? null,
    unknownFields: [...unknown],
    authorSample,
  };
}

export function fromRest(input: {
  repo: RestRepo;
  openPrs: number;
  languageBytes: Record<string, number>;
  recentDefaultCommits: number;
  recentAuthors: string[];
  prAuthors: Array<{ login: string; type: string }>;
  fetchedAt: string;
  unknownFields?: MetricField[];
  authorSample?: AuthorSample;
}): RepoMetrics {
  const { owner, name } = splitFullName(input.repo.full_name);
  const rawOpen = input.repo.open_issues_count;
  const openIssues = Math.max(0, rawOpen - input.openPrs);
  return {
    owner,
    name,
    fullName: input.repo.full_name,
    url: input.repo.html_url,
    description: input.repo.description,
    stars: input.repo.stargazers_count,
    forks: input.repo.forks_count,
    openIssues,
    openPrs: input.openPrs,
    sizeKb: input.repo.size,
    languageBytes: input.languageBytes,
    primaryLanguage: input.repo.language,
    pushedAt: input.repo.pushed_at,
    updatedAt: input.repo.updated_at,
    recentDefaultCommits: input.recentDefaultCommits,
    recentAuthors: input.recentAuthors,
    prAuthors: input.prAuthors,
    fetchedAt: input.fetchedAt,
    source: "github-rest",
    repoId: input.repo.id ?? null,
    isPrivate: input.repo.private ?? null,
    unknownFields: input.unknownFields ?? [],
    authorSample: input.authorSample ?? {
      prAuthorsInspected: input.prAuthors.length,
      recentCommitsInspected: input.recentDefaultCommits,
      complete: true,
    },
  };
}

/** Fields whose values are placeholders rather than measurements. */
export function unknownFieldsOf(metrics: RepoMetrics): MetricField[] {
  return metrics.unknownFields ?? [];
}
