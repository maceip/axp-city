import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CityEvent } from "./types.js";

export interface EventStore {
  /**
   * Replay the JSONL log into the dedup set and buffer. Corrupt lines are
   * skipped and counted — a torn write never prevents startup.
   */
  load(): Promise<{ loaded: number; skipped: number }>;
  /**
   * Durably append, then mark seen. The write happens FIRST so a crash
   * before ack means GitHub retries (safe: the retry is not yet marked
   * seen). Throws on I/O failure — the caller must answer 5xx without
   * marking the delivery seen, so the retry still lands.
   */
  append(event: CityEvent): Promise<boolean>;
  recent(limit: number): CityEvent[];
  has(id: string): boolean;
  readonly size: number;
}

function isCityEvent(value: unknown): value is CityEvent {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.receivedAt === "string" &&
    typeof row.repo === "string" &&
    typeof row.signal === "string"
  );
}

/**
 * In-memory ring buffer (newest first) backed by an append-only JSONL file.
 * The file is the durable feed the city page (or a later poller) reads; the
 * buffer serves live SSE subscribers without touching disk.
 */
export function createEventStore(logPath: string, capacity = 500): EventStore {
  const seen = new Set<string>();
  const buffer: CityEvent[] = [];
  let ensured = false;
  let writing: Promise<unknown> = Promise.resolve();

  async function ensureDir(): Promise<void> {
    if (ensured) return;
    await mkdir(dirname(logPath), { recursive: true });
    ensured = true;
  }

  function remember(event: CityEvent): void {
    seen.add(event.id);
    buffer.unshift(event);
    if (buffer.length > capacity) buffer.length = capacity;
  }

  return {
    async load(): Promise<{ loaded: number; skipped: number }> {
      let loaded = 0;
      let skipped = 0;
      let text: string;
      try {
        text = await readFile(logPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { loaded, skipped };
        }
        throw error;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row: unknown = JSON.parse(line);
          if (!isCityEvent(row)) {
            skipped += 1;
            continue;
          }
          if (!seen.has(row.id)) {
            remember(row);
            loaded += 1;
          }
        } catch {
          skipped += 1;
        }
      }
      // File order is oldest-first; unshifting each row leaves the buffer
      // newest-first, matching live appends.
      return { loaded, skipped };
    },

    append(event: CityEvent): Promise<boolean> {
      const next = writing.then(async () => {
        if (seen.has(event.id)) return false;
        await ensureDir();
        await appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
        remember(event);
        return true;
      });
      writing = next.catch(() => {});
      return next;
    },

    recent(limit: number): CityEvent[] {
      return buffer.slice(0, Math.max(0, limit));
    },

    has(id: string): boolean {
      return seen.has(id);
    },

    get size(): number {
      return seen.size;
    },
  };
}
