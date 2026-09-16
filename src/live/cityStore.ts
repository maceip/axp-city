import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CityLot, RepoMetrics } from "../types.js";
import {
  LAYOUT_VERSION,
  nextFreeSlot,
  planCity,
  type CityPlan,
  type SlotAssignment,
} from "../world/layout.js";
import { lotSlot, slotKey } from "../world/slots.js";
import type { CityEvent } from "../webhooks/types.js";
import type {
  CityFreshness,
  CityMode,
  CityMutation,
  CitySnapshot,
} from "./protocol.js";
import { SNAPSHOT_SCHEMA } from "./protocol.js";
import { repoName } from "../rules/load.js";
export { CONSTRUCTION_MS } from "../world/constants.js";
export type { CityMutation } from "./protocol.js";

/** Storage schema version. Unknown versions are refused, never guessed at. */
export const STORAGE_SCHEMA = 3;
/** Refreshes older than this are shown as stale in the client. */
export const DEFAULT_STALE_AFTER_MS = 45 * 60_000;

export type LotStatus = "published" | "withdrawn";

export interface StoredLot {
  position: number;
  fullName: string;
  repoId: number | null;
  slot: SlotAssignment;
  layoutVersion: number;
  addedAt: string;
  status: LotStatus;
  withdrawnReason: string | null;
  lot: CityLot;
  metrics: RepoMetrics | null;
}

export interface LotHistoryEntry {
  fullName: string;
  at: string;
  kind: "added" | "renamed" | "withdrawn" | "restored" | "identity";
  detail: string;
}

export type DeliveryStatus = "pending" | "processing" | "done" | "failed" | "ignored";

export interface StoredDelivery {
  id: string;
  receivedAt: string;
  repo: string;
  event: CityEvent;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  completedAt: string | null;
  /** Deliveries for private repositories are processed but never published. */
  publishable: boolean;
}

export interface RefreshOutcome {
  fullName: string;
  at: string;
  ok: boolean;
  error?: string;
}

export interface RetentionPolicy {
  /** Diagnostic events older than this are pruned (newest `eventsKeep` always kept). */
  eventDays: number;
  eventsKeep: number;
  /** Completed/ignored deliveries older than this are pruned. */
  deliveryDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  eventDays: 30,
  eventsKeep: 500,
  deliveryDays: 14,
};

export interface CityStoreOptions {
  /** Legacy JSON map/event log to import on first start, then renamed aside. */
  legacyMapPath?: string;
  legacyEventLogPath?: string;
  staleAfterMs?: number;
  retention?: Partial<RetentionPolicy>;
  source?: CityFreshness["source"];
  /**
   * Data-path guard: a database created by one mode refuses to open in the
   * other, so fixture refreshes can never overwrite live GitHub state.
   */
  mode?: CityMode;
}

export interface CityStore {
  load(): Promise<{ migrated: boolean }>;
  close(): void;
  /** Bootstrap-only: add lots that do not exist yet without touching existing ones. */
  hydrate(
    lots: CityLot[],
    addedAt?: Record<string, string>,
    metrics?: RepoMetrics[],
  ): Promise<void>;
  lots(): CityLot[];
  /** Every stored row including withdrawn tombstones. */
  rows(): StoredLot[];
  row(fullName: string): StoredLot | undefined;
  addedAt(): Record<string, string>;
  lastGoodMetrics(fullName: string): RepoMetrics | undefined;
  snapshot(mode?: CityMode): CitySnapshot;
  plan(): CityPlan;
  freshness(): CityFreshness;
  /**
   * Add, refresh, rename, or restore a lot. Returns null when nothing visible
   * changed (freshness is still recorded). Rejects private repositories.
   */
  ensure(
    fullName: string,
    lot?: CityLot,
    at?: string,
    metrics?: RepoMetrics,
  ): Promise<CityMutation | null>;
  /** Withdraw a lot's public data; its slot stays reserved so neighbors never move. */
  withdraw(fullName: string, reason: string): Promise<CityMutation | null>;
  history(fullName?: string): LotHistoryEntry[];
  recordRefresh(outcome: RefreshOutcome): void;
  onMutation(fn: (event: CityMutation) => void): () => void;
  /** Durable delivery queue. */
  enqueueDelivery(event: CityEvent, publishable: boolean): boolean;
  hasDelivery(id: string): boolean;
  nextDelivery(now?: string): StoredDelivery | undefined;
  completeDelivery(id: string, at?: string): void;
  ignoreDelivery(id: string, at?: string): void;
  failDelivery(id: string, error: string, retryAt: string | null): void;
  /** Hold a delivery until `until` without counting an attempt (event coalescing). */
  deferDelivery(id: string, until: string): void;
  deliveryCounts(): Record<DeliveryStatus, number>;
  /** Public diagnostic events (visibility already enforced at write time). */
  appendEvent(event: CityEvent): boolean;
  recentEvents(limit: number): CityEvent[];
  eventCount(): number;
  prune(now?: string): { events: number; deliveries: number };
  backup(destination: string): Promise<void>;
  /** Probe that the database accepts writes; used by readiness checks. */
  writable(): boolean;
  readonly isOpen: boolean;
  readonly path: string;
  readonly database: DatabaseSync;
}

const IGNORED_FOR_CHANGE: Array<keyof CityLot> = ["fetchedAt", "dataSource"];

/** Two lots are visibly identical when everything but freshness bookkeeping matches. */
export function lotsEquivalent(a: CityLot, b: CityLot): boolean {
  const strip = (lot: CityLot) => {
    const copy: Record<string, unknown> = { ...lot };
    for (const key of IGNORED_FOR_CHANGE) delete copy[key];
    if (lot.partial)
      copy.partial = { carriedFields: [...lot.partial.carriedFields].sort() };
    return JSON.stringify(copy, Object.keys(copy).sort());
  };
  return strip(a) === strip(b);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createCityStore(
  path: string,
  options: CityStoreOptions = {},
): CityStore {
  const legacyMapPath =
    options.legacyMapPath ?? join(dirname(path), "city-map.json");
  const legacyEventLogPath =
    options.legacyEventLogPath ?? join(dirname(path), "city-events.jsonl");
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const retention: RetentionPolicy = {
    ...DEFAULT_RETENTION,
    ...options.retention,
  };
  let db!: DatabaseSync;
  let opened = false;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(event: CityMutation) => void>();
  let cache: StoredLot[] | undefined;
  let refreshCache: CityFreshness | undefined;

  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  }

  function open(): void {
    db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lots (
        position INTEGER PRIMARY KEY,
        full_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        repo_id INTEGER,
        col INTEGER NOT NULL,
        row INTEGER NOT NULL,
        layout_version INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        withdrawn_reason TEXT,
        withdrawn_at TEXT,
        lot_json TEXT NOT NULL,
        metrics_json TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (col, row)
      );
      CREATE INDEX IF NOT EXISTS lots_repo_id ON lots(repo_id);
      CREATE TABLE IF NOT EXISTS lot_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position INTEGER NOT NULL,
        full_name TEXT NOT NULL COLLATE NOCASE,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        repo TEXT NOT NULL,
        event_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        completed_at TEXT,
        publishable INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS lot_history_position ON lot_history(position);
      CREATE INDEX IF NOT EXISTS deliveries_status ON deliveries(status, next_attempt_at);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        received_at TEXT NOT NULL,
        repo TEXT NOT NULL,
        signal TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS refresh_status (
        full_name TEXT PRIMARY KEY COLLATE NOCASE,
        last_success_at TEXT,
        last_attempt_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
      );
    `);
    const stored = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    if (!stored) {
      db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(
        String(STORAGE_SCHEMA),
      );
      db.prepare("INSERT INTO meta(key, value) VALUES ('revision', '0')").run();
      db.prepare(
        "INSERT INTO meta(key, value) VALUES ('layout_version', ?)",
      ).run(String(LAYOUT_VERSION));
    } else if (Number(stored.value) !== STORAGE_SCHEMA) {
      db.close();
      throw new Error(
        `Unsupported city database schema ${stored.value}; this server understands schema ${STORAGE_SCHEMA}`,
      );
    }
    const layout = db
      .prepare("SELECT value FROM meta WHERE key = 'layout_version'")
      .get() as { value: string } | undefined;
    if (layout && Number(layout.value) !== LAYOUT_VERSION) {
      db.close();
      throw new Error(
        `City layout version ${layout.value} requires an explicit migration to ${LAYOUT_VERSION}; refusing to move addresses implicitly`,
      );
    }
    if (options.mode) {
      const storedMode = meta("mode");
      if (!storedMode) setMeta("mode", options.mode);
      else if (storedMode !== options.mode) {
        db.close();
        throw new Error(
          `City database ${path} belongs to ${storedMode} mode; refusing to open it in ${options.mode} mode (set CITY_DATA_DIR to a separate directory)`,
        );
      }
    }
    // Deliveries interrupted mid-processing are retried, not lost.
    db.prepare(
      "UPDATE deliveries SET status = 'pending' WHERE status = 'processing'",
    ).run();
    opened = true;
  }

  function meta(key: string): string | undefined {
    return (
      db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
        | { value: string }
        | undefined
    )?.value;
  }

  function setMeta(key: string, value: string): void {
    db.prepare(
      "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }

  function revision(): number {
    return Number(meta("revision") ?? "0");
  }

  function bumpRevision(): number {
    const next = revision() + 1;
    setMeta("revision", String(next));
    return next;
  }

  interface LotRow {
    position: number;
    full_name: string;
    repo_id: number | null;
    col: number;
    row: number;
    layout_version: number;
    added_at: string;
    status: string;
    withdrawn_reason: string | null;
    lot_json: string;
    metrics_json: string | null;
  }

  function toStored(row: LotRow): StoredLot {
    return {
      position: row.position,
      fullName: row.full_name,
      repoId: row.repo_id,
      slot: { col: row.col, row: row.row },
      layoutVersion: row.layout_version,
      addedAt: row.added_at,
      status: row.status as LotStatus,
      withdrawnReason: row.withdrawn_reason,
      lot: JSON.parse(row.lot_json) as CityLot,
      metrics: row.metrics_json
        ? (JSON.parse(row.metrics_json) as RepoMetrics)
        : null,
    };
  }

  function allRows(): StoredLot[] {
    if (!cache)
      cache = (
        db.prepare("SELECT * FROM lots ORDER BY position").all() as unknown as LotRow[]
      ).map(toStored);
    return cache;
  }

  function invalidate(): void {
    cache = undefined;
    refreshCache = undefined;
  }

  function rowByName(name: string): StoredLot | undefined {
    const folded = name.toLowerCase();
    return allRows().find((r) => r.fullName.toLowerCase() === folded);
  }

  function rowByRepoId(id: number): StoredLot | undefined {
    return allRows().find((r) => r.repoId === id);
  }

  function published(): StoredLot[] {
    return allRows().filter((r) => r.status === "published");
  }

  function assignments(): Record<string, SlotAssignment> {
    const out: Record<string, SlotAssignment> = {};
    for (const r of published()) out[r.lot.fullName] = r.slot;
    return out;
  }

  function reservedSlots(): SlotAssignment[] {
    return allRows()
      .filter((r) => r.status !== "published")
      .map((r) => r.slot);
  }

  function occupiedSlots(): Set<string> {
    return new Set(allRows().map((r) => slotKey(r.slot.col, r.slot.row)));
  }

  function buildPlan(now = nowIso()): CityPlan {
    const rows = published();
    return planCity(
      rows.map((r) => structuredClone(r.lot)),
      {
        addedAt: Object.fromEntries(rows.map((r) => [r.lot.fullName, r.addedAt])),
        now,
        assignments: assignments(),
        reserved: reservedSlots(),
      },
    );
  }

  function freshness(): CityFreshness {
    if (refreshCache) return refreshCache;
    const agg = db
      .prepare(
        "SELECT MAX(last_success_at) AS ok, SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS failing FROM refresh_status",
      )
      .get() as { ok: string | null; failing: number | null };
    const failure = db
      .prepare(
        "SELECT last_attempt_at AS at, last_error AS error FROM refresh_status WHERE last_error IS NOT NULL ORDER BY last_attempt_at DESC LIMIT 1",
      )
      .get() as { at: string; error: string } | undefined;
    refreshCache = {
      lastSuccessfulRefreshAt: agg?.ok ?? null,
      lastFailureAt: failure?.at ?? null,
      lastError: failure?.error ?? null,
      staleAfterMs,
      failingRepositories: Number(agg?.failing ?? 0),
      source: options.source ?? "github-token",
    };
    return refreshCache;
  }

  function insertLot(
    lot: CityLot,
    slot: SlotAssignment,
    at: string,
    metrics: RepoMetrics | null,
  ): void {
    db.prepare(
      `INSERT INTO lots(full_name, repo_id, col, row, layout_version, added_at, status, lot_json, metrics_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
    ).run(
      lot.fullName,
      lot.repoId ?? null,
      slot.col,
      slot.row,
      LAYOUT_VERSION,
      at,
      JSON.stringify(lot),
      metrics ? JSON.stringify(metrics) : null,
      at,
    );
    const position = Number(
      (db.prepare("SELECT position FROM lots WHERE full_name = ?").get(lot.fullName) as {
        position: number;
      }).position,
    );
    addHistory(position, lot.fullName, at, "added", `slot ${slot.col},${slot.row}`);
  }

  /** History follows the lot (its position), so renames keep one timeline. */
  function addHistory(
    position: number,
    fullName: string,
    at: string,
    kind: LotHistoryEntry["kind"],
    detail: string,
  ): void {
    db.prepare(
      "INSERT INTO lot_history(position, full_name, at, kind, detail) VALUES (?, ?, ?, ?, ?)",
    ).run(position, fullName, at, kind, detail);
  }

  function emit(event: CityMutation): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        /* one disconnected subscriber cannot undo a committed update */
      }
    }
  }

  function transaction<T>(work: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      invalidate();
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw error;
    }
  }

  function geometryOf(plan: CityPlan): Omit<CityPlan, "placements"> {
    const { placements: _placements, ...geometry } = plan;
    return geometry;
  }

  async function importLegacy(): Promise<boolean> {
    let migrated = false;
    try {
      const data = JSON.parse(await readFile(legacyMapPath, "utf8")) as {
        version?: number;
        revision?: number;
        order?: string[];
        lots?: CityLot[];
        addedAt?: Record<string, string>;
      };
      if (!Array.isArray(data.order) || !Array.isArray(data.lots))
        throw new Error("Invalid city map: missing order/lots");
      if (data.version !== undefined && ![1, 2].includes(data.version))
        throw new Error(`Unsupported legacy city map version ${data.version}`);
      const byName = new Map(
        data.lots.map((lot) => [repoName(lot.fullName).toLowerCase(), lot]),
      );
      const lots = data.order.map((name) => byName.get(name.toLowerCase()));
      if (
        lots.some((lot) => !lot) ||
        new Set(data.order.map((name) => name.toLowerCase())).size !==
          lots.length
      )
        throw new Error("Invalid city map: duplicate or missing lot");
      const at = nowIso();
      transaction(() => {
        // The legacy planner assigned lotSlot(index) by order; reproduce it
        // exactly so no address moves during migration.
        data.order!.forEach((name, i) => {
          const slot = lotSlot(i);
          const lot = { ...(lots[i] as CityLot), fullName: name };
          if (!("crewBasis" in lot))
            (lot as CityLot).crewBasis =
              "Classification predates crew labels; refresh to update.";
          insertLot(
            lot,
            { col: slot.sx, row: slot.sy },
            data.addedAt?.[name] ?? "2020-01-01T00:00:00.000Z",
            null,
          );
        });
        setMeta("revision", String(data.revision ?? 0));
        setMeta("imported_city_map_at", at);
      });
      await rename(legacyMapPath, `${legacyMapPath}.imported-${at.replaceAll(":", "")}`);
      migrated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      const text = await readFile(legacyEventLogPath, "utf8");
      transaction(() => {
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line) as CityEvent;
            if (
              typeof row.id === "string" &&
              typeof row.repo === "string" &&
              typeof row.signal === "string"
            )
              db.prepare(
                "INSERT OR IGNORE INTO events(id, received_at, repo, signal, event_json) VALUES (?, ?, ?, ?, ?)",
              ).run(row.id, row.receivedAt, row.repo, row.signal, line);
          } catch {
            /* torn line */
          }
        }
      });
      await rename(
        legacyEventLogPath,
        `${legacyEventLogPath}.imported-${nowIso().replaceAll(":", "")}`,
      );
      migrated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return migrated;
  }

  const store: CityStore = {
    path,
    get database() {
      return db;
    },
    async load() {
      await mkdir(dirname(path), { recursive: true });
      open();
      let migrated = false;
      const count = (
        db.prepare("SELECT COUNT(*) AS n FROM lots").get() as { n: number }
      ).n;
      if (count === 0) migrated = await importLegacy();
      invalidate();
      return { migrated };
    },
    close() {
      if (!opened) return;
      opened = false;
      db?.close();
    },
    get isOpen() {
      return opened;
    },
    hydrate(lots, timestamps = {}, metrics = []) {
      return serial(async () => {
        const byName = new Map(
          metrics.map((m) => [m.fullName.toLowerCase(), m]),
        );
        transaction(() => {
          const occupied = occupiedSlots();
          let changed = false;
          for (const lot of lots) {
            repoName(lot.fullName);
            const existing = rowByName(lot.fullName);
            if (existing) continue;
            const slot = nextFreeSlot(occupied);
            occupied.add(slotKey(slot.col, slot.row));
            insertLot(
              lot,
              slot,
              timestamps[lot.fullName] ?? "2020-01-01T00:00:00.000Z",
              byName.get(lot.fullName.toLowerCase()) ?? null,
            );
            invalidate();
            changed = true;
          }
          if (changed) bumpRevision();
        });
      });
    },
    lots: () => published().map((r) => structuredClone(r.lot)),
    rows: () => allRows().map((r) => structuredClone(r)),
    row: (fullName) => {
      const r = rowByName(fullName);
      return r ? structuredClone(r) : undefined;
    },
    addedAt: () =>
      Object.fromEntries(published().map((r) => [r.lot.fullName, r.addedAt])),
    lastGoodMetrics: (fullName) => {
      const r = rowByName(fullName);
      return r?.metrics ? structuredClone(r.metrics) : undefined;
    },
    plan: () => buildPlan(),
    freshness,
    snapshot(mode = "live") {
      const serverTime = nowIso();
      return {
        version: 1,
        schema: { snapshot: SNAPSHOT_SCHEMA, layout: LAYOUT_VERSION },
        revision: revision(),
        serverTime,
        mode,
        plan: buildPlan(serverTime),
        freshness: freshness(),
      };
    },
    ensure(fullName, lot, at = nowIso(), metrics) {
      return serial(async () => {
        repoName(fullName);
        if (!lot) {
          if (rowByName(fullName)) return null;
          throw new Error("A new lot requires resolved repository metrics");
        }
        repoName(lot.fullName);
        if (metrics?.isPrivate === true)
          throw new Error(`Repository ${lot.fullName} is private and cannot be published`);
        const byId = lot.repoId != null ? rowByRepoId(lot.repoId) : undefined;
        const byNewName = rowByName(lot.fullName);
        const byRequested = rowByName(fullName);
        if (byId && byNewName && byId.position !== byNewName.position)
          throw new Error(
            `Repository identity conflict: id ${lot.repoId} is ${byId.fullName} but ${lot.fullName} is already a different lot`,
          );
        const row = byId ?? byNewName ?? byRequested;
        if (
          row &&
          !byId &&
          lot.repoId == null &&
          row.fullName.toLowerCase() !== lot.fullName.toLowerCase()
        )
          throw new Error("Repository identity mismatch");
        return transaction(() => {
          if (!row) {
            const slot = nextFreeSlot(occupiedSlots());
            insertLot(lot, slot, at, metrics ?? null);
            invalidate();
            const rev = bumpRevision();
            const plan = buildPlan(at);
            const placement = plan.placements.find(
              (p) => p.lot.fullName === lot.fullName,
            )!;
            const event: CityMutation = {
              type: "lot_added",
              revision: rev,
              serverTime: at,
              placement,
              geometry: geometryOf(plan),
            };
            emit(event);
            return event;
          }
          const renamed = row.fullName !== lot.fullName;
          const restored = row.status !== "published";
          const identityChanged =
            row.repoId != null && lot.repoId != null && row.repoId !== lot.repoId;
          const previousName = row.fullName;
          const changed =
            renamed ||
            restored ||
            identityChanged ||
            !lotsEquivalent(row.lot, lot);
          db.prepare(
            `UPDATE lots SET full_name = ?, repo_id = ?, status = 'published', withdrawn_reason = NULL, withdrawn_at = NULL,
             lot_json = ?, metrics_json = COALESCE(?, metrics_json), updated_at = ? WHERE position = ?`,
          ).run(
            lot.fullName,
            lot.repoId ?? row.repoId,
            JSON.stringify(lot),
            metrics ? JSON.stringify(metrics) : null,
            at,
            row.position,
          );
          if (renamed)
            addHistory(row.position, lot.fullName, at, "renamed", `from ${previousName}`);
          if (identityChanged)
            addHistory(
              row.position,
              lot.fullName,
              at,
              "identity",
              `repository id ${row.repoId} → ${lot.repoId}`,
            );
          if (restored)
            addHistory(row.position, lot.fullName, at, "restored", row.withdrawnReason ?? "");
          invalidate();
          if (!changed) return null;
          const rev = bumpRevision();
          const plan = buildPlan(at);
          const placement = plan.placements.find(
            (p) => p.lot.fullName === lot.fullName,
          )!;
          let event: CityMutation;
          if (restored)
            event = {
              type: "lot_added",
              revision: rev,
              serverTime: at,
              placement,
              geometry: geometryOf(plan),
            };
          else if (renamed)
            event = {
              type: "lot_renamed",
              revision: rev,
              serverTime: at,
              previousFullName: previousName,
              placement,
            };
          else
            event = {
              type: "lot_updated",
              revision: rev,
              serverTime: at,
              placement,
            };
          emit(event);
          return event;
        });
      });
    },
    withdraw(fullName, reason) {
      return serial(async () => {
        const row = rowByName(fullName);
        if (!row || row.status === "withdrawn") return null;
        const at = nowIso();
        return transaction(() => {
          db.prepare(
            "UPDATE lots SET status = 'withdrawn', withdrawn_reason = ?, withdrawn_at = ?, updated_at = ? WHERE position = ?",
          ).run(reason, at, at, row.position);
          db.prepare("DELETE FROM events WHERE repo = ? COLLATE NOCASE").run(
            row.fullName,
          );
          addHistory(row.position, row.fullName, at, "withdrawn", reason);
          invalidate();
          const rev = bumpRevision();
          const event: CityMutation = {
            type: "lot_removed",
            revision: rev,
            serverTime: at,
            fullName: row.fullName,
            reason,
            geometry: geometryOf(buildPlan(at)),
          };
          emit(event);
          return event;
        });
      });
    },
    history(fullName) {
      const target = fullName ? rowByName(fullName) : undefined;
      if (fullName && !target) return [];
      const rows = (
        target
          ? db
              .prepare(
                "SELECT full_name, at, kind, detail FROM lot_history WHERE position = ? ORDER BY id",
              )
              .all(target.position)
          : db
              .prepare("SELECT full_name, at, kind, detail FROM lot_history ORDER BY id")
              .all()
      ) as unknown as Array<{ full_name: string; at: string; kind: string; detail: string }>;
      return rows.map((r) => ({
        fullName: r.full_name,
        at: r.at,
        kind: r.kind as LotHistoryEntry["kind"],
        detail: r.detail,
      }));
    },
    recordRefresh(outcome) {
      db.prepare(
        `INSERT INTO refresh_status(full_name, last_success_at, last_attempt_at, last_error, consecutive_failures)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at,
           last_success_at = COALESCE(excluded.last_success_at, refresh_status.last_success_at),
           last_error = excluded.last_error,
           consecutive_failures = CASE WHEN excluded.last_error IS NULL THEN 0 ELSE refresh_status.consecutive_failures + 1 END`,
      ).run(
        outcome.fullName,
        outcome.ok ? outcome.at : null,
        outcome.at,
        outcome.ok ? null : (outcome.error ?? "failed"),
        outcome.ok ? 0 : 1,
      );
      refreshCache = undefined;
    },
    onMutation(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    enqueueDelivery(event, publishable) {
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO deliveries(id, received_at, repo, event_json, status, publishable)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
        )
        .run(event.id, event.receivedAt, event.repo, JSON.stringify(event), publishable ? 1 : 0);
      return Number(result.changes) > 0;
    },
    hasDelivery(id) {
      return Boolean(db.prepare("SELECT 1 FROM deliveries WHERE id = ?").get(id));
    },
    nextDelivery(now = nowIso()) {
      const row = db
        .prepare(
          `SELECT * FROM deliveries WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY received_at LIMIT 1`,
        )
        .get(now) as
        | {
            id: string;
            received_at: string;
            repo: string;
            event_json: string;
            status: string;
            attempts: number;
            next_attempt_at: string | null;
            last_error: string | null;
            completed_at: string | null;
            publishable: number;
          }
        | undefined;
      if (!row) return undefined;
      db.prepare("UPDATE deliveries SET status = 'processing' WHERE id = ?").run(row.id);
      return {
        id: row.id,
        receivedAt: row.received_at,
        repo: row.repo,
        event: JSON.parse(row.event_json) as CityEvent,
        status: "processing",
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        lastError: row.last_error,
        completedAt: row.completed_at,
        publishable: row.publishable === 1,
      };
    },
    completeDelivery(id, at = nowIso()) {
      db.prepare(
        "UPDATE deliveries SET status = 'done', completed_at = ?, last_error = NULL, attempts = attempts + 1 WHERE id = ?",
      ).run(at, id);
    },
    ignoreDelivery(id, at = nowIso()) {
      db.prepare(
        "UPDATE deliveries SET status = 'ignored', completed_at = ?, attempts = attempts + 1 WHERE id = ?",
      ).run(at, id);
    },
    deferDelivery(id, until) {
      // Not a failure: the delivery simply waits for the coalescing window.
      db.prepare(
        "UPDATE deliveries SET status = 'pending', next_attempt_at = ? WHERE id = ?",
      ).run(until, id);
    },
    failDelivery(id, error, retryAt) {
      db.prepare(
        `UPDATE deliveries SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ?, completed_at = CASE WHEN ? IS NULL THEN ? ELSE NULL END WHERE id = ?`,
      ).run(
        retryAt ? "pending" : "failed",
        error.slice(0, 1000),
        retryAt,
        retryAt,
        nowIso(),
        id,
      );
    },
    deliveryCounts() {
      const counts: Record<DeliveryStatus, number> = {
        pending: 0,
        processing: 0,
        done: 0,
        failed: 0,
        ignored: 0,
      };
      for (const row of db
        .prepare("SELECT status, COUNT(*) AS n FROM deliveries GROUP BY status")
        .all() as unknown as Array<{ status: DeliveryStatus; n: number }>)
        counts[row.status] = Number(row.n);
      return counts;
    },
    appendEvent(event) {
      const result = db
        .prepare(
          "INSERT OR IGNORE INTO events(id, received_at, repo, signal, event_json) VALUES (?, ?, ?, ?, ?)",
        )
        .run(event.id, event.receivedAt, event.repo, event.signal, JSON.stringify(event));
      return Number(result.changes) > 0;
    },
    recentEvents(limit) {
      return (
        db
          .prepare("SELECT event_json FROM events ORDER BY seq DESC LIMIT ?")
          .all(Math.max(0, limit)) as unknown as Array<{ event_json: string }>
      ).map((r) => JSON.parse(r.event_json) as CityEvent);
    },
    eventCount() {
      return Number(
        (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n,
      );
    },
    prune(now = nowIso()) {
      const cutoffEvents = new Date(
        Date.parse(now) - retention.eventDays * 86_400_000,
      ).toISOString();
      const cutoffDeliveries = new Date(
        Date.parse(now) - retention.deliveryDays * 86_400_000,
      ).toISOString();
      return transaction(() => {
        const events = db
          .prepare(
            `DELETE FROM events WHERE received_at < ? AND seq NOT IN (SELECT seq FROM events ORDER BY seq DESC LIMIT ?)`,
          )
          .run(cutoffEvents, retention.eventsKeep);
        const deliveries = db
          .prepare(
            `DELETE FROM deliveries WHERE status IN ('done', 'ignored') AND completed_at < ?`,
          )
          .run(cutoffDeliveries);
        return {
          events: Number(events.changes),
          deliveries: Number(deliveries.changes),
        };
      });
    },
    async backup(destination) {
      await mkdir(dirname(destination), { recursive: true });
      try {
        await stat(destination);
        throw new Error(`Backup destination already exists: ${destination}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      db.prepare("VACUUM INTO ?").run(destination);
    },
    writable() {
      try {
        db.exec("BEGIN IMMEDIATE");
        db.prepare(
          "INSERT INTO meta(key, value) VALUES ('write_probe', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ).run(nowIso());
        db.exec("COMMIT");
        return true;
      } catch {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* nothing to roll back */
        }
        return false;
      }
    },
  };
  return store;
}
