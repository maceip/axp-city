import { readFile } from "node:fs/promises";
import { RECENT_ACTIVITY_DAYS } from "../parser/thresholds.js";
import type { RepoMetrics } from "../types.js";
import {
  fromGraphQl,
  fromRest,
  type GraphQlRepository,
  type RestRepo,
} from "./normalize.js";

const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_URL = "https://api.github.com";
const USER_AGENT = "axp-city-ingest";

export interface FetchOptions {
  token?: string;
  now?: Date;
  recentDays?: number;
}

export class GitHubHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "GitHubHttpError";
  }
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

const REPO_FIELDS = `
  nameWithOwner
  url
  description
  stargazerCount
  forkCount
  diskUsage
  pushedAt
  updatedAt
  primaryLanguage { name }
  languages(first: 8, orderBy: {field: SIZE, direction: DESC}) {
    edges { size node { name } }
  }
  issues(states: OPEN) { totalCount }
  pullRequests(states: OPEN) { totalCount }
  defaultBranchRef {
    name
    target {
      ... on Commit {
        recentCount: history(since: $since) { totalCount }
        recent: history(first: 15) {
          nodes {
            committedDate
            authors(first: 3) {
              nodes { name user { login } }
            }
          }
        }
      }
    }
  }
  openPrAuthors: pullRequests(first: 20, states: OPEN) {
    nodes { author { login __typename } }
  }
`;

export async function fetchViaGraphQl(
  repos: Array<{ owner: string; name: string }>,
  options: FetchOptions = {},
): Promise<RepoMetrics[]> {
  const token = options.token;
  if (!token) {
    throw new Error("GraphQL ingest requires GITHUB_TOKEN");
  }
  const now = options.now ?? new Date();
  const since = isoDaysAgo(now, options.recentDays ?? RECENT_ACTIVITY_DAYS);
  const aliases = repos.map((repo, i) => {
    const owner = JSON.stringify(repo.owner);
    const name = JSON.stringify(repo.name);
    return `r${i}: repository(owner: ${owner}, name: ${name}) { ...F }`;
  });
  const query = `query($since: GitTimestamp!) { ${aliases.join("\n")} } fragment F on Repository { ${REPO_FIELDS} }`;

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { since } }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new GitHubHttpError(
      `GraphQL HTTP ${response.status}`,
      response.status,
      text,
    );
  }
  const payload = JSON.parse(text) as {
    data?: Record<string, GraphQlRepository | null>;
    errors?: Array<{ message: string }>;
  };
  if (payload.errors?.length && !payload.data) {
    throw new Error(
      `GraphQL errors: ${payload.errors.map((e) => e.message).join("; ")}`,
    );
  }
  const fetchedAt = now.toISOString();
  const out: RepoMetrics[] = [];
  for (let i = 0; i < repos.length; i++) {
    const row = payload.data?.[`r${i}`];
    if (!row) {
      throw new Error(
        `Repository not found: ${repos[i].owner}/${repos[i].name}`,
      );
    }
    out.push(fromGraphQl(row, fetchedAt));
  }
  return out;
}

async function restJson<T>(
  path: string,
  token?: string,
): Promise<{ data: T; remaining: number | null; lastPage: number }> {
  const response = await fetch(`${REST_URL}${path}`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  const remaining = response.headers.get("x-ratelimit-remaining");
  const text = await response.text();
  if (!response.ok) {
    throw new GitHubHttpError(
      `REST HTTP ${response.status} ${path}`,
      response.status,
      text,
    );
  }
  return {
    data: JSON.parse(text) as T,
    lastPage: Number(
      response.headers
        .get("link")
        ?.match(/[?&]page=(\d+)[^>]*>; rel="last"/)?.[1] ?? 1,
    ),
    remaining: remaining === null ? null : Number(remaining),
  };
}

async function fetchOneRest(
  owner: string,
  name: string,
  options: FetchOptions,
): Promise<RepoMetrics> {
  const token = options.token;
  const now = options.now ?? new Date();
  const since = isoDaysAgo(now, options.recentDays ?? RECENT_ACTIVITY_DAYS);
  const repoRes = await restJson<RestRepo>(`/repos/${owner}/${name}`, token);
  const pullsRes = await restJson<
    Array<{ user?: { login?: string; type?: string } | null }>
  >(`/repos/${owner}/${name}/pulls?state=open&per_page=100`, token);
  let openPrs = pullsRes.data.length;
  if (pullsRes.lastPage > 1) {
    const last = await restJson<unknown[]>(
      `/repos/${owner}/${name}/pulls?state=open&per_page=100&page=${pullsRes.lastPage}`,
      token,
    );
    openPrs = (pullsRes.lastPage - 1) * 100 + last.data.length;
  }
  let languageBytes: Record<string, number> = {};
  try {
    const langs = await restJson<Record<string, number>>(
      `/repos/${owner}/${name}/languages`,
      token,
    );
    languageBytes = langs.data;
  } catch {
    languageBytes = {};
  }
  let recentDefaultCommits = 0;
  let recentAuthors: string[] = [];
  try {
    const commits = await restJson<
      Array<{
        commit?: { author?: { date?: string; name?: string } };
        author?: { login?: string; type?: string } | null;
      }>
    >(
      `/repos/${owner}/${name}/commits?since=${encodeURIComponent(since)}&per_page=30`,
      token,
    );
    recentDefaultCommits = commits.data.length;
    recentAuthors = [
      ...new Set(
        commits.data
          .map((c) => c.author?.login ?? c.commit?.author?.name)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
  } catch {
    recentDefaultCommits = 0;
  }
  const prAuthors = pullsRes.data
    .map((p) => ({
      login: p.user?.login ?? "",
      type: p.user?.type ?? "User",
    }))
    .filter((a) => a.login);

  return fromRest({
    repo: repoRes.data,
    openPrs,
    languageBytes,
    recentDefaultCommits,
    recentAuthors,
    prAuthors,
    fetchedAt: now.toISOString(),
  });
}

export async function fetchViaRest(
  repos: Array<{ owner: string; name: string }>,
  options: FetchOptions = {},
): Promise<RepoMetrics[]> {
  const out: RepoMetrics[] = [];
  for (const repo of repos) {
    out.push(await fetchOneRest(repo.owner, repo.name, options));
  }
  return out;
}

export async function fetchRepoMetrics(
  repos: Array<{ owner: string; name: string }>,
  options: FetchOptions = {},
): Promise<RepoMetrics[]> {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const merged = { ...options, token };
  if (token) {
    try {
      return await fetchViaGraphQl(repos, merged);
    } catch (error) {
      console.warn(
        `[ingest] GraphQL failed (${error instanceof Error ? error.message : error}); falling back to REST`,
      );
    }
  } else {
    console.warn(
      "[ingest] No GITHUB_TOKEN — using unauthenticated REST (60 req/hour)",
    );
  }
  return fetchViaRest(repos, merged);
}

export async function loadFixtureSnapshot(
  path: string,
): Promise<RepoMetrics[]> {
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    metrics?: RepoMetrics[];
  };
  if (!Array.isArray(raw.metrics)) {
    throw new Error(`Fixture ${path} has no metrics[]`);
  }
  return raw.metrics.map((row) => ({ ...row, source: "fixture" as const }));
}
