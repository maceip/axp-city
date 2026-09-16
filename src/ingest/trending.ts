import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TrendingCadence } from "../types.js";

export type TrendingSource = "github-trending" | "last-good-cache" | "test-fixture";

export interface TrendingLists {
  daily: string[];
  weekly: string[];
  monthly: string[];
  fetchedAt: string;
  source: TrendingSource;
}

export interface TrendingResult {
  lists: TrendingLists | null;
  ok: boolean;
  usedCache: boolean;
  error?: string;
}

export interface RankedTrendingRepo {
  fullName: string;
  cadence: TrendingCadence;
}

const GITHUB_TRENDING = "https://github.com/trending";
const USER_AGENT = "axp-city/1.0 (+https://github.com/maceip/axp-city)";
const PAGE_TIMEOUT_MS = 20_000;

const RESERVED_OWNERS = new Set([
  "topics",
  "trending",
  "features",
  "settings",
  "orgs",
  "marketplace",
  "sponsors",
  "about",
  "login",
  "signup",
  "explore",
  "notifications",
  "issues",
  "pulls",
  "codespaces",
  "copilot",
  "enterprise",
  "pricing",
  "security",
  "blog",
  "apps",
  "collections",
  "events",
  "skills",
  "organizations",
  "users",
  "search",
  "new",
  "dashboard",
  "account",
  "settings",
  "orgs",
]);

const REPO_HREF =
  /<h2\b[^>]*>[\s\S]*?<a\b[^>]*\bhref="\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)"/gi;

function isRepoName(owner: string, name: string): boolean {
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return false;
  if (owner.startsWith(".")) return false;
  if (name.includes(".")) {
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    if (["png", "jpg", "svg", "css", "js", "gif", "webp"].includes(ext)) return false;
  }
  return true;
}

/** Extract owner/name rows from a GitHub trending HTML page, in rank order. */
export function parseTrendingHtml(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of html.matchAll(REPO_HREF)) {
    const owner = match[1];
    const name = match[2];
    if (!isRepoName(owner, name)) continue;
    const fullName = `${owner}/${name}`;
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fullName);
  }
  return out;
}

function asRepoList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.includes("/")) continue;
    const [owner, name] = item.split("/");
    if (!owner || !name || !isRepoName(owner, name)) continue;
    const fullName = `${owner}/${name}`;
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fullName);
  }
  return out;
}

/** JSON snapshot or a raw trending HTML page. */
export function parseTrendingPayload(raw: string, now = new Date()): TrendingLists {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed) as Partial<TrendingLists> & { metrics?: unknown };
    if (Array.isArray(data))
      return {
        daily: asRepoList(data),
        weekly: [],
        monthly: [],
        fetchedAt: now.toISOString(),
        source: "test-fixture",
      };
    return {
      daily: asRepoList(data.daily),
      weekly: asRepoList(data.weekly),
      monthly: asRepoList(data.monthly),
      fetchedAt: typeof data.fetchedAt === "string" ? data.fetchedAt : now.toISOString(),
      source: data.source === "github-trending" ? "github-trending" : "test-fixture",
    };
  }
  const daily = parseTrendingHtml(trimmed);
  return {
    daily,
    weekly: [],
    monthly: [],
    fetchedAt: now.toISOString(),
    source: "test-fixture",
  };
}

/**
 * Daily wins over weekly over monthly so a repo that appears in several
 * windows is plotted once, on the most current street.
 */
export function mergeTrending(lists: TrendingLists): RankedTrendingRepo[] {
  const rank = new Map<string, RankedTrendingRepo>();
  const add = (names: string[], cadence: TrendingCadence) => {
    for (const fullName of names) {
      rank.set(fullName.toLowerCase(), { fullName, cadence });
    }
  };
  add(lists.monthly, "monthly");
  add(lists.weekly, "weekly");
  add(lists.daily, "daily");
  const order: RankedTrendingRepo[] = [];
  const seen = new Set<string>();
  for (const list of [lists.daily, lists.weekly, lists.monthly]) {
    for (const name of list) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      const row = rank.get(key);
      if (!row) continue;
      seen.add(key);
      order.push(row);
    }
  }
  return order;
}

export async function fetchTrendingPage(
  since: TrendingCadence,
  request: typeof fetch = fetch,
): Promise<string[]> {
  const url = `${GITHUB_TRENDING}?since=${since}`;
  const response = await request(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`GitHub trending ${since} returned HTTP ${response.status}`);
  const html = await response.text();
  const names = parseTrendingHtml(html);
  if (names.length === 0)
    throw new Error(`GitHub trending ${since} page had no repositories`);
  return names;
}

export async function readTrendingCache(path: string): Promise<TrendingLists | null> {
  try {
    const lists = parseTrendingPayload(await readFile(path, "utf8"));
    lists.source = "last-good-cache";
    return lists;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeTrendingCache(path: string, lists: TrendingLists): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(lists, null, 2)}\n`);
}

export interface ObtainTrendingOptions {
  cachePath: string;
  fixturePath?: string;
  request?: typeof fetch;
  now?: () => Date;
}

/**
 * Live: fetch GitHub trending. On failure, return the last-good cache and the
 * error — never a recorded fixture city. `fixturePath` is only for tests.
 */
export async function obtainTrending(options: ObtainTrendingOptions): Promise<TrendingResult> {
  const now = options.now ?? (() => new Date());
  if (options.fixturePath) {
    const lists = parseTrendingPayload(await readFile(options.fixturePath, "utf8"), now());
    lists.source = "test-fixture";
    return { lists, ok: true, usedCache: false };
  }
  const request = options.request ?? fetch;
  try {
    const [daily, weekly, monthly] = await Promise.all([
      fetchTrendingPage("daily", request),
      fetchTrendingPage("weekly", request),
      fetchTrendingPage("monthly", request),
    ]);
    const lists: TrendingLists = {
      daily,
      weekly,
      monthly,
      fetchedAt: now().toISOString(),
      source: "github-trending",
    };
    await writeTrendingCache(options.cachePath, lists);
    return { lists, ok: true, usedCache: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cached = await readTrendingCache(options.cachePath);
    return {
      lists: cached,
      ok: false,
      usedCache: Boolean(cached),
      error: message,
    };
  }
}
