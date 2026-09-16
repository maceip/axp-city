import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "./args.js";
import { fullNames, readRepoList } from "../repos.js";
import {
  buildSnapshot,
  fetchRepoMetrics,
  loadFixtureSnapshot,
  writePerRepoFixtures,
  writeSnapshot,
} from "../ingest/index.js";

export async function runIngest(argv = process.argv.slice(2)): Promise<string> {
  const args = parseArgs(argv);
  const repos = await readRepoList(args.reposFile);
  const names = fullNames(repos);
  let metrics;
  if (args.offline) {
    console.log(`[ingest] offline — loading ${args.snapshotPath}`);
    metrics = await loadFixtureSnapshot(args.snapshotPath);
  } else {
    metrics = await fetchRepoMetrics(repos);
    const snapshot = buildSnapshot(metrics, names);
    await writeSnapshot(snapshot, args.snapshotPath);
    await writePerRepoFixtures(metrics, `${args.fixturesDir}/repos`);
    console.log(
      `[ingest] fetched ${metrics.length} repos via ${snapshot.source}`,
    );
  }

  const ordered = names
    .map((full) =>
      metrics.find((m) => m.fullName.toLowerCase() === full.toLowerCase()),
    )
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (ordered.length !== names.length) {
    const have = new Set(metrics.map((m) => m.fullName.toLowerCase()));
    const missing = names.filter((n) => !have.has(n.toLowerCase()));
    throw new Error(`Snapshot is missing repos: ${missing.join(", ")}`);
  }

  await mkdir(args.outDir, { recursive: true });
  const metricsPath = join(args.outDir, "metrics.json");
  await writeFile(metricsPath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  console.log(`[ingest] wrote ${metricsPath}`);
  return metricsPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runIngest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
