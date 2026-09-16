import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseLot } from "../parser/parseLot.js";
import { lotGroup, lotHitSvg } from "../render/city.js";
import type { CityLot, RepoMetrics } from "../types.js";
import { CONSTRUCTION_MS } from "../world/constants.js";
import { planCity } from "../world/layout.js";

export interface LiveLot {
  repo: string;
  url: string;
  stars: number;
  issues: number;
  prs: number;
  band: CityLot["buildingBand"];
  id: number;
  yard: string;
  occupant: CityLot["occupantClass"];
  constructing: boolean;
  district: string;
  x: number;
  y: number;
  col: number;
  row: number;
  props: string[];
}

export interface CityMutation {
  type: "lot_added";
  lot: LiveLot;
  svg: string;
  hit: string;
}

export interface CityStore {
  load(): Promise<void>;
  hydrate(lots: CityLot[], addedAt?: Record<string, string>): Promise<void>;
  lots(): CityLot[];
  addedAt(): Record<string, string>;
  ensure(fullName: string, lot?: CityLot, at?: string): Promise<CityMutation | null>;
  onMutation(fn: (event: CityMutation) => void): () => void;
}

function stubMetrics(fullName: string): RepoMetrics {
  const [owner, name] = fullName.split("/");
  return {
    owner: owner || "unknown",
    name: name || fullName,
    fullName,
    url: `https://github.com/${fullName}`,
    description: null,
    stars: 0,
    forks: 0,
    openIssues: 0,
    openPrs: 0,
    sizeKb: 0,
    languageBytes: {},
    primaryLanguage: null,
    pushedAt: null,
    updatedAt: null,
    recentDefaultCommits: 0,
    recentAuthors: [],
    prAuthors: [],
    fetchedAt: new Date().toISOString(),
    source: "fixture",
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mutationFor(
  lots: CityLot[],
  addedAt: Record<string, string>,
  fullName: string,
): CityMutation {
  const plan = planCity(lots, { addedAt, now: Date.now() });
  const index = plan.placements.findIndex((p) => p.lot.fullName === fullName);
  const place = plan.placements[index];
  if (!place) throw new Error(`placed lot missing: ${fullName}`);
  const lot = place.lot;
  return {
    type: "lot_added",
    lot: {
      repo: lot.fullName,
      url: lot.url,
      stars: lot.stars,
      issues: lot.openIssues,
      prs: lot.openPrs,
      band: lot.buildingBand,
      id: lot.buildingId,
      yard: lot.yard.replaceAll("_", " "),
      occupant: lot.occupantClass,
      constructing: true,
      district: place.district,
      x: place.x,
      y: place.y,
      col: place.col,
      row: place.row,
      props: [],
    },
    svg: lotGroup({ ...place, constructing: true }, index),
    hit: lotHitSvg(place),
  };
}

export function createCityStore(path: string): CityStore {
  let order: string[] = [];
  let added: Record<string, string> = {};
  const byName = new Map<string, CityLot>();
  const listeners = new Set<(event: CityMutation) => void>();
  let writing = Promise.resolve();

  function currentLots(): CityLot[] {
    return order.map((name) => byName.get(name)).filter((lot): lot is CityLot => Boolean(lot));
  }

  async function persist(): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ version: 1, order, addedAt: added, lots: currentLots() }, null, 2)}\n`,
      "utf8",
    );
  }

  function queuePersist(): Promise<void> {
    writing = writing.then(persist, persist);
    return writing;
  }

  return {
    async load(): Promise<void> {
      try {
        const text = await readFile(path, "utf8");
        const parsed = JSON.parse(text) as {
          order?: string[];
          addedAt?: Record<string, string>;
          lots?: CityLot[];
        };
        order = Array.isArray(parsed.order) ? parsed.order : [];
        added = parsed.addedAt && typeof parsed.addedAt === "object" ? parsed.addedAt : {};
        byName.clear();
        for (const lot of parsed.lots ?? []) {
          if (lot && typeof lot.fullName === "string") byName.set(lot.fullName, lot);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },

    async hydrate(lots: CityLot[], addedAt = {}): Promise<void> {
      for (const lot of lots) {
        if (!order.includes(lot.fullName)) order.push(lot.fullName);
        byName.set(lot.fullName, lot);
        if (addedAt[lot.fullName]) added[lot.fullName] = addedAt[lot.fullName];
        if (!added[lot.fullName]) added[lot.fullName] = "2020-01-01T00:00:00.000Z";
      }
      await queuePersist();
    },

    lots: currentLots,

    addedAt(): Record<string, string> {
      return { ...added };
    },

    async ensure(fullName: string, lot?: CityLot, at?: string): Promise<CityMutation | null> {
      if (byName.has(fullName) || order.includes(fullName)) {
        if (lot) byName.set(fullName, lot);
        await queuePersist();
        return null;
      }
      const resolved = lot ?? parseLot(stubMetrics(fullName));
      const when = at ?? new Date().toISOString();
      order.push(fullName);
      byName.set(fullName, resolved);
      added[fullName] = when;
      await queuePersist();
      const mutation = mutationFor(currentLots(), added, fullName);
      for (const send of listeners) send(mutation);
      return mutation;
    },

    onMutation(fn: (event: CityMutation) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export { CONSTRUCTION_MS };
