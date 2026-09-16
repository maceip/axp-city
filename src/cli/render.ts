import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "./args.js";
import { parseCity } from "../parser/index.js";
import { loadLocalRules } from "../rules/load.js";
import { planCity } from "../world/index.js";
import type { RepoMetrics } from "../types.js";
export async function runRender(argv = process.argv.slice(2)): Promise<string> {
  const args = parseArgs(argv);
  const metrics = JSON.parse(
    await readFile(join(args.outDir, "metrics.json"), "utf8"),
  ) as RepoMetrics[];
  const lots = parseCity(metrics, { rules: await loadLocalRules() });
  await mkdir(args.outDir, { recursive: true });
  await writeFile(
    join(args.outDir, "lots.json"),
    JSON.stringify(lots, null, 2),
  );
  const path = join(args.outDir, "city-plan.json");
  await writeFile(path, JSON.stringify(planCity(lots), null, 2));
  console.log(
    `[render] exported ${lots.length} lots as JSON; npm run dev opens the Phaser city`,
  );
  return path;
}
if (import.meta.url === `file://${process.argv[1]}`)
  void runRender().catch((error) => {
    console.error(error);
    process.exit(1);
  });
