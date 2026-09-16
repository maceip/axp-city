import { mkdir, readFile, writeFile, rename, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { CityLot } from "../types.js";
import { planCity } from "../world/layout.js";
import type { CityMutation, CitySnapshot } from "./protocol.js";
import { repoName } from "../rules/load.js";
export { CONSTRUCTION_MS } from "../world/constants.js";
export type { CityMutation } from "./protocol.js";
interface State {
  version: 2;
  revision: number;
  order: string[];
  addedAt: Record<string, string>;
  lots: CityLot[];
}
export interface CityStore {
  load(): Promise<void>;
  hydrate(lots: CityLot[], addedAt?: Record<string, string>): Promise<void>;
  lots(): CityLot[];
  addedAt(): Record<string, string>;
  snapshot(mode?: "live" | "offline"): CitySnapshot;
  ensure(
    fullName: string,
    lot?: CityLot,
    at?: string,
  ): Promise<CityMutation | null>;
  onMutation(fn: (event: CityMutation) => void): () => void;
}
export function createCityStore(path: string): CityStore {
  let state: State = {
    version: 2,
    revision: 0,
    order: [],
    addedAt: {},
    lots: [],
  };
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(event: CityMutation) => void>();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  }
  async function commit(next: State): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    await writeFile(temp, `${JSON.stringify(next)}\n`, "utf8");
    const fd = await open(temp, "r+");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
    await rename(temp, path);
    state = next;
  }
  return {
    async load() {
      try {
        const data = JSON.parse(await readFile(path, "utf8")) as Partial<State>;
        if (!Array.isArray(data.order) || !Array.isArray(data.lots))
          throw new Error("Invalid city map: missing order/lots");
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
        // Version 1 map order is the address contract; retain it during migration.
        state = {
          version: 2,
          revision: data.revision ?? 0,
          order: data.order,
          lots: lots as CityLot[],
          addedAt: data.addedAt ?? {},
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
    hydrate(lots, timestamps = {}) {
      return serial(async () => {
        const next = structuredClone(state);
        for (const lot of lots) {
          repoName(lot.fullName);
          const i = next.order.findIndex(
            (name) => name.toLowerCase() === lot.fullName.toLowerCase(),
          );
          if (i < 0) {
            next.order.push(lot.fullName);
            next.lots.push(lot);
          } else {
            next.lots[i] = { ...lot, fullName: next.order[i] };
          }
          const key = i < 0 ? lot.fullName : next.order[i];
          next.addedAt[key] ??=
            timestamps[lot.fullName] ?? "2020-01-01T00:00:00.000Z";
        }
        next.revision++;
        await commit(next);
      });
    },
    lots: () => structuredClone(state.lots),
    addedAt: () => ({ ...state.addedAt }),
    snapshot(mode = "live") {
      const serverTime = new Date().toISOString();
      return {
        version: 1,
        revision: state.revision,
        serverTime,
        mode,
        plan: planCity(structuredClone(state.lots), {
          addedAt: state.addedAt,
          now: serverTime,
        }),
      };
    },
    ensure(fullName, lot, at = new Date().toISOString()) {
      return serial(async () => {
        repoName(fullName);
        const i = state.order.findIndex(
          (name) => name.toLowerCase() === fullName.toLowerCase(),
        );
        if (!lot) {
          if (i >= 0) return null;
          throw new Error("A new lot requires resolved repository metrics");
        }
        if (lot.fullName.toLowerCase() !== fullName.toLowerCase())
          throw new Error("Repository identity mismatch");
        const next = structuredClone(state);
        if (i < 0) {
          next.order.push(lot.fullName);
          next.lots.push(lot);
          next.addedAt[lot.fullName] = at;
        } else {
          next.lots[i] = { ...lot, fullName: next.order[i] };
        }
        next.revision++;
        await commit(next);
        const plan = planCity(state.lots, { addedAt: state.addedAt });
        const { placements, ...geometry } = plan;
        const event: CityMutation = {
          type: i < 0 ? "lot_added" : "lot_updated",
          revision: state.revision,
          serverTime: new Date().toISOString(),
          placement: placements[i < 0 ? placements.length - 1 : i],
          ...(i < 0 ? { geometry } : {}),
        };
        for (const listener of listeners) {
          try {
            listener(event);
          } catch {
            /* one disconnected subscriber cannot undo a committed update */
          }
        }
        return event;
      });
    },
    onMutation(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
