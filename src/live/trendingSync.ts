import { join } from "node:path";
import {
  mergeTrending,
  obtainTrending,
  type TrendingResult,
} from "../ingest/trending.js";
import type { TrendingCadence } from "../types.js";
import type { Logger } from "../webhooks/server.js";
import type { CityStore } from "./cityStore.js";
import type { TrendingFreshness } from "./protocol.js";

export interface TrendingSyncOptions {
  city: CityStore;
  dataDir: string;
  fixturePath?: string;
  pins?: string[];
  intervalMs: number;
  log?: Logger;
  enabled?: boolean;
  request?: typeof fetch;
  refresh: (fullName: string, options?: { cadence?: TrendingCadence }) => Promise<unknown>;
}

export interface TrendingPass {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  usedCache: boolean;
  enrolled: string[];
  withdrawn: string[];
  failed: string[];
  error?: string;
}

function freshnessFrom(
  result: TrendingResult,
  previous?: TrendingFreshness,
): TrendingFreshness {
  const lists = result.lists;
  const now = new Date().toISOString();
  return {
    lastSuccessfulFetchAt:
      result.ok && lists ? lists.fetchedAt : (previous?.lastSuccessfulFetchAt ?? null),
    lastFailureAt: result.ok ? previous?.lastFailureAt ?? null : now,
    lastError: result.ok ? null : (result.error ?? "trending fetch failed"),
    source: lists?.source ?? previous?.source ?? null,
    counts: {
      daily: lists?.daily.length ?? 0,
      weekly: lists?.weekly.length ?? 0,
      monthly: lists?.monthly.length ?? 0,
    },
    fetchedAt: lists?.fetchedAt ?? null,
    usingCache: result.usedCache,
  };
}

/**
 * Keep the published city aligned with GitHub trending. A failed fetch keeps
 * last-good membership and records the error; it never loads fixture repos.
 */
export function createTrendingSync(options: TrendingSyncOptions) {
  const log = options.log ?? (() => {});
  const pins = new Set((options.pins ?? []).map((name) => name.toLowerCase()));
  const cachePath = join(options.dataDir, "trending-snapshot.json");
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<TrendingPass | undefined> | undefined;
  let lastPass: TrendingPass | undefined;

  async function pass(): Promise<TrendingPass | undefined> {
    if (options.enabled === false) return undefined;
    const startedAt = new Date().toISOString();
    const result = await obtainTrending({
      cachePath,
      fixturePath: options.fixturePath,
      request: options.request,
    });
    options.city.setTrending(freshnessFrom(result, options.city.trending()));
    const outcome: TrendingPass = {
      startedAt,
      finishedAt: startedAt,
      ok: result.ok,
      usedCache: result.usedCache,
      enrolled: [],
      withdrawn: [],
      failed: [],
      error: result.error,
    };
    if (!result.lists) {
      outcome.finishedAt = new Date().toISOString();
      lastPass = outcome;
      log("warn", "trending list unavailable; city membership unchanged", {
        error: result.error,
      });
      return outcome;
    }
    const ranked = mergeTrending(result.lists);
    const keep = new Set(ranked.map((row) => row.fullName.toLowerCase()));
    for (const pin of pins) keep.add(pin);
    for (const row of ranked) {
      try {
        await options.refresh(row.fullName, { cadence: row.cadence });
        outcome.enrolled.push(row.fullName);
      } catch (error) {
        outcome.failed.push(row.fullName);
        log("warn", `trending enroll ${row.fullName} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Only drop lots after a successful live fetch. A cache replay fills
    // gaps on an empty city but does not evict published buildings.
    if (result.ok) {
      for (const lot of options.city.lots()) {
        if (keep.has(lot.fullName.toLowerCase())) continue;
        try {
          await options.city.withdraw(lot.fullName, "left-trending");
          outcome.withdrawn.push(lot.fullName);
        } catch (error) {
          log("warn", `trending withdraw ${lot.fullName} failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    outcome.finishedAt = new Date().toISOString();
    lastPass = outcome;
    log("info", "trending sync finished", {
      ok: outcome.ok,
      usedCache: outcome.usedCache,
      enrolled: outcome.enrolled.length,
      withdrawn: outcome.withdrawn.length,
      failed: outcome.failed.length,
      source: result.lists.source,
    });
    return outcome;
  }

  return {
    run(): Promise<TrendingPass | undefined> {
      if (!running)
        running = pass().finally(() => {
          running = undefined;
        });
      return running;
    },
    start(opts: { immediate?: boolean } = {}): void {
      if (timer || options.enabled === false) return;
      timer = setInterval(() => {
        void this.run();
      }, options.intervalMs);
      timer.unref?.();
      if (opts.immediate !== false) void this.run();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    lastPass: () => lastPass,
  };
}
