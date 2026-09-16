import { readFile } from "node:fs/promises";
import { RECENT_ACTIVITY_DAYS } from "../parser/thresholds.js";
import type { MetricField, RepoMetrics } from "../types.js";
import {
  fromGraphQl,
  fromRest,
  REST_COMMIT_SAMPLE,
  REST_PR_AUTHOR_SAMPLE,
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
  /** Injected for tests; defaults to global fetch. */
  request?: typeof fetch;
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

/**
 * The repository itself is not readable: it was deleted, renamed away, became
 * private, or the credential lost access. Callers withdraw published data
 * instead of retrying blindly.
 */
export class RepositoryUnavailableError extends Error {
  constructor(
    readonly fullName: string,
    readonly reason: "not_found" | "forbidden",
    detail = "",
  ) {
    super(
      `Repository ${fullName} is ${reason === "not_found" ? "not found" : "not accessible"}${detail ? `: ${detail}` : ""}`,
    );
    this.name = "RepositoryUnavailableError";
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
  databaseId
  isPrivate
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

interface GraphQlError {
  message: string;
  type?: string;
  path?: Array<string | number>;
}

/** Group GraphQL field errors by repository alias, as dotted paths below it. */
export function groupFieldErrors(
  errors: GraphQlError[] | undefined,
): Map<string, { paths: Set<string>; root?: GraphQlError }> {
  const out = new Map<string, { paths: Set<string>; root?: GraphQlError }>();
  for (const error of errors ?? []) {
    const [alias, ...rest] = error.path ?? [];
    if (typeof alias !== "string") continue;
    const entry = out.get(alias) ?? { paths: new Set<string>() };
    if (rest.length === 0) entry.root = error;
    else
      entry.paths.add(
        rest.filter((segment) => typeof segment === "string").join("."),
      );
    out.set(alias, entry);
  }
  return out;
}

export async function fetchViaGraphQl(
  repos: Array<{ owner: string; name: string }>,
  options: FetchOptions = {},
): Promise<RepoMetrics[]> {
  const token = options.token;
  if (!token) {
    throw new Error("GraphQL ingest requires GITHUB_TOKEN");
  }
  const request = options.request ?? fetch;
  const now = options.now ?? new Date();
  const since = isoDaysAgo(now, options.recentDays ?? RECENT_ACTIVITY_DAYS);
  const aliases = repos.map((repo, i) => {
    const owner = JSON.stringify(repo.owner);
    const name = JSON.stringify(repo.name);
    return `r${i}: repository(owner: ${owner}, name: ${name}) { ...F }`;
  });
  const query = `query($since: GitTimestamp!) { ${aliases.join("\n")} } fragment F on Repository { ${REPO_FIELDS} }`;

  const response = await request(GRAPHQL_URL, {
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
    errors?: GraphQlError[];
  };
  if (payload.errors?.length && !payload.data) {
    throw new Error(
      `GraphQL errors: ${payload.errors.map((e) => e.message).join("; ")}`,
    );
  }
  const errors = groupFieldErrors(payload.errors);
  const fetchedAt = now.toISOString();
  const out: RepoMetrics[] = [];
  for (let i = 0; i < repos.length; i++) {
    const alias = `r${i}`;
    const row = payload.data?.[alias];
    const fullName = `${repos[i].owner}/${repos[i].name}`;
    const failure = errors.get(alias);
    if (!row) {
      const type = failure?.root?.type;
      throw new RepositoryUnavailableError(
        fullName,
        type === "FORBIDDEN" ? "forbidden" : "not_found",
        failure?.root?.message,
      );
    }
    out.push(
      fromGraphQl(row, fetchedAt, {
        since,
        erroredPaths: failure?.paths ?? [],
      }),
    );
  }
  return out;
}

async function restJson<T>(
  path: string,
  token?: string,
  request: typeof fetch = fetch,
): Promise<{ data: T; remaining: number | null; lastPage: number }> {
  const response = await request(`${REST_URL}${path}`, {
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
  const request = options.request ?? fetch;
  const now = options.now ?? new Date();
  const since = isoDaysAgo(now, options.recentDays ?? RECENT_ACTIVITY_DAYS);
  const fullName = `${owner}/${name}`;
  let repoRes: Awaited<ReturnType<typeof restJson<RestRepo>>>;
  try {
    repoRes = await restJson<RestRepo>(`/repos/${owner}/${name}`, token, request);
  } catch (error) {
    if (error instanceof GitHubHttpError) {
      if (error.status === 404)
        throw new RepositoryUnavailableError(fullName, "not_found");
      // 403 with remaining quota is an authorization failure; exhausted quota is transient.
      if (
        (error.status === 403 || error.status === 401) &&
        !/rate limit/i.test(error.body)
      )
        throw new RepositoryUnavailableError(fullName, "forbidden");
    }
    throw error;
  }
  const unknown = new Set<MetricField>();
  let openPrs = 0;
  let prAuthors: Array<{ login: string; type: string }> = [];
  let prAuthorsInspected = 0;
  try {
    const pullsRes = await restJson<
      Array<{ user?: { login?: string; type?: string } | null }>
    >(`/repos/${owner}/${name}/pulls?state=open&per_page=100`, token, request);
    openPrs = pullsRes.data.length;
    if (pullsRes.lastPage > 1) {
      const last = await restJson<unknown[]>(
        `/repos/${owner}/${name}/pulls?state=open&per_page=100&page=${pullsRes.lastPage}`,
        token,
        request,
      );
      openPrs = (pullsRes.lastPage - 1) * 100 + last.data.length;
    }
    prAuthors = pullsRes.data
      .map((p) => ({
        login: p.user?.login ?? "",
        type: p.user?.type ?? "User",
      }))
      .filter((a) => a.login);
    prAuthorsInspected = pullsRes.data.length;
  } catch {
    // Open issues are derived from open_issues_count minus PRs, so both are unknown.
    unknown.add("openPrs");
    unknown.add("prAuthors");
    unknown.add("openIssues");
  }
  let languageBytes: Record<string, number> = {};
  try {
    const langs = await restJson<Record<string, number>>(
      `/repos/${owner}/${name}/languages`,
      token,
      request,
    );
    languageBytes = langs.data;
  } catch {
    unknown.add("languageBytes");
  }
  let recentDefaultCommits = 0;
  let recentAuthors: string[] = [];
  let recentCommitsInspected = 0;
  try {
    const commits = await restJson<
      Array<{
        commit?: { author?: { date?: string; name?: string } };
        author?: { login?: string; type?: string } | null;
      }>
    >(
      `/repos/${owner}/${name}/commits?since=${encodeURIComponent(since)}&per_page=${REST_COMMIT_SAMPLE}`,
      token,
      request,
    );
    recentDefaultCommits = commits.data.length;
    recentCommitsInspected = commits.data.length;
    recentAuthors = [
      ...new Set(
        commits.data
          .map((c) => c.author?.login ?? c.commit?.author?.name)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
  } catch {
    unknown.add("recentDefaultCommits");
    unknown.add("recentAuthors");
  }

  return fromRest({
    repo: repoRes.data,
    openPrs,
    languageBytes,
    recentDefaultCommits,
    recentAuthors,
    prAuthors,
    fetchedAt: now.toISOString(),
    unknownFields: [...unknown],
    authorSample: {
      prAuthorsInspected,
      recentCommitsInspected,
      complete:
        !unknown.has("prAuthors") &&
        !unknown.has("recentAuthors") &&
        openPrs <= REST_PR_AUTHOR_SAMPLE &&
        recentDefaultCommits < REST_COMMIT_SAMPLE,
    },
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
      if (error instanceof RepositoryUnavailableError) throw error;
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
