import type { RepoMetrics } from "../types.js";

export interface GraphQlRepository {
  nameWithOwner: string;
  url: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  diskUsage: number | null;
  pushedAt: string | null;
  updatedAt: string | null;
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

function recentAuthors(repo: GraphQlRepository): string[] {
  const seen = new Set<string>();
  const nodes = repo.defaultBranchRef?.target?.recent?.nodes ?? [];
  for (const node of nodes) {
    for (const author of node?.authors?.nodes ?? []) {
      const login = author?.user?.login ?? author?.name;
      if (login) seen.add(login);
    }
  }
  return [...seen];
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

export function fromGraphQl(
  repo: GraphQlRepository,
  fetchedAt: string,
): RepoMetrics {
  const { owner, name } = splitFullName(repo.nameWithOwner);
  return {
    owner,
    name,
    fullName: repo.nameWithOwner,
    url: repo.url,
    description: repo.description,
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    openIssues: repo.issues?.totalCount ?? 0,
    openPrs: repo.pullRequests?.totalCount ?? 0,
    sizeKb: repo.diskUsage ?? 0,
    languageBytes: languageMap(repo.languages),
    primaryLanguage: repo.primaryLanguage?.name ?? null,
    pushedAt: repo.pushedAt,
    updatedAt: repo.updatedAt,
    recentDefaultCommits: repo.defaultBranchRef?.target?.recentCount?.totalCount ?? 0,
    recentAuthors: recentAuthors(repo),
    prAuthors: prAuthors(repo),
    fetchedAt,
    source: "github-graphql",
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
  };
}
