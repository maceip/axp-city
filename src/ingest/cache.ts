import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IngestSnapshot, RepoMetrics } from "../types.js";

export function fixtureFileName(fullName: string): string {
  return `${fullName.replaceAll("/", "--")}.json`;
}

export async function writeSnapshot(
  snapshot: IngestSnapshot,
  outPath: string,
): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function writePerRepoFixtures(
  metrics: RepoMetrics[],
  dir: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all(
    metrics.map((row) =>
      writeFile(
        join(dir, fixtureFileName(row.fullName)),
        `${JSON.stringify(row, null, 2)}\n`,
        "utf8",
      ),
    ),
  );
}

export function buildSnapshot(
  metrics: RepoMetrics[],
  repos: string[],
): IngestSnapshot {
  const fetchedAt = metrics[0]?.fetchedAt ?? new Date().toISOString();
  const sources = new Set(metrics.map((m) => m.source));
  return {
    fetchedAt,
    asOf: fetchedAt,
    source: sources.size === 1 ? ([...sources][0] ?? "mixed") : "mixed",
    repos,
    metrics,
  };
}
