import type { CityStore } from "./cityStore.js";
import type { CityFreshness } from "./protocol.js";
import type { Logger } from "../webhooks/server.js";

export interface ReconcilerOptions {
  city: CityStore;
  refresh(fullName: string): Promise<unknown>;
  intervalMs: number;
  /** Gap between consecutive repository refreshes inside one pass. */
  spacingMs?: number;
  log?: Logger;
  /** Called when the city transitions to stale or back to fresh, and when deliveries pile up. */
  alert?: (alert: CityAlert) => void | Promise<void>;
  enabled?: boolean;
  now?: () => number;
}

export interface CityAlert {
  kind: "stale" | "recovered" | "delivery_backlog" | "refresh_failures";
  message: string;
  at: string;
  freshness: CityFreshness;
}

export interface ReconcilePass {
  startedAt: string;
  finishedAt: string;
  attempted: number;
  succeeded: number;
  failed: string[];
}

/**
 * Reconciliation recovers changes that no webhook delivered: each pass
 * re-fetches every published lot through the canonical resolver. It runs
 * regardless of webhook configuration, so repositories without authorized
 * event access still update on the polling cadence. Withdrawals happen inside
 * the refresh path when a repository stops being readable.
 */
export function createReconciler(options: ReconcilerOptions) {
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  let running: Promise<ReconcilePass | undefined> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let wasStale: boolean | undefined;
  let lastPass: ReconcilePass | undefined;

  function isStale(): boolean {
    const freshness = options.city.freshness();
    if (options.city.lots().length === 0) return false;
    const last = freshness.lastSuccessfulRefreshAt
      ? Date.parse(freshness.lastSuccessfulRefreshAt)
      : NaN;
    return Number.isNaN(last) || now() - last > freshness.staleAfterMs;
  }

  async function evaluateAlerts(pass?: ReconcilePass): Promise<void> {
    const stale = isStale();
    const freshness = options.city.freshness();
    const at = new Date(now()).toISOString();
    if (wasStale !== undefined && stale !== wasStale) {
      await options.alert?.({
        kind: stale ? "stale" : "recovered",
        message: stale
          ? `No successful GitHub refresh since ${freshness.lastSuccessfulRefreshAt ?? "startup"}; last error: ${freshness.lastError ?? "none"}`
          : `GitHub refreshes recovered at ${freshness.lastSuccessfulRefreshAt}`,
        at,
        freshness,
      });
    }
    wasStale = stale;
    if (pass && pass.attempted > 0 && pass.failed.length === pass.attempted)
      await options.alert?.({
        kind: "refresh_failures",
        message: `Every repository refresh failed in the last pass (${pass.failed.length}): ${freshness.lastError ?? "unknown error"}`,
        at,
        freshness,
      });
    const counts = options.city.deliveryCounts();
    if (counts.failed > 0 || counts.pending > 50)
      await options.alert?.({
        kind: "delivery_backlog",
        message: `Delivery queue: ${counts.pending} pending, ${counts.failed} failed permanently`,
        at,
        freshness,
      });
  }

  async function pass(): Promise<ReconcilePass | undefined> {
    if (options.enabled === false) return undefined;
    const startedAt = new Date(now()).toISOString();
    const result: ReconcilePass = {
      startedAt,
      finishedAt: startedAt,
      attempted: 0,
      succeeded: 0,
      failed: [],
    };
    for (const lot of options.city.lots()) {
      result.attempted++;
      try {
        await options.refresh(lot.fullName);
        result.succeeded++;
      } catch (error) {
        result.failed.push(lot.fullName);
        log("warn", `reconcile ${lot.fullName} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (options.spacingMs)
        await new Promise((resolve) => setTimeout(resolve, options.spacingMs));
    }
    result.finishedAt = new Date(now()).toISOString();
    lastPass = result;
    log("info", "reconcile pass finished", {
      attempted: result.attempted,
      succeeded: result.succeeded,
      failed: result.failed.length,
    });
    await evaluateAlerts(result);
    return result;
  }

  return {
    /** Run one pass now (shared with any pass already in flight). */
    run(): Promise<ReconcilePass | undefined> {
      if (!running)
        running = pass().finally(() => {
          running = undefined;
        });
      return running;
    },
    start(): void {
      if (timer || options.enabled === false) return;
      timer = setInterval(() => {
        void this.run();
      }, options.intervalMs);
      timer.unref?.();
      // Staleness must surface even when a pass cannot start (e.g. GitHub down).
      const watchdog = setInterval(() => {
        void evaluateAlerts();
      }, Math.min(options.intervalMs, 60_000));
      watchdog.unref?.();
      (timer as NodeJS.Timeout & { watchdog?: NodeJS.Timeout }).watchdog = watchdog;
      void this.run();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        const watchdog = (timer as NodeJS.Timeout & { watchdog?: NodeJS.Timeout }).watchdog;
        if (watchdog) clearInterval(watchdog);
      }
      timer = undefined;
    },
    isStale,
    lastPass: () => lastPass,
  };
}

/** Post alerts to an operator-supplied HTTPS endpoint (chat webhook, pager). */
export function httpAlerter(
  url: string,
  request: typeof fetch = fetch,
  log: Logger = () => {},
): (alert: CityAlert) => Promise<void> {
  return async (alert) => {
    try {
      const response = await request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "axp-city" },
        body: JSON.stringify({
          text: `[axp-city] ${alert.kind}: ${alert.message}`,
          ...alert,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) log("warn", `alert delivery HTTP ${response.status}`, { kind: alert.kind });
    } catch (error) {
      log("warn", "alert delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
