import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "./args.js";
import { parseCity } from "../parser/index.js";
import { renderCityHtml } from "../render/index.js";
import type { RepoMetrics } from "../types.js";

export async function runRender(argv = process.argv.slice(2)): Promise<string> {
  const args = parseArgs(argv);
  const metricsPath = join(args.outDir, "metrics.json");
  const metrics = JSON.parse(await readFile(metricsPath, "utf8")) as RepoMetrics[];
  const lots = parseCity(metrics);
  const generatedAt = new Date().toISOString();
  await mkdir(args.outDir, { recursive: true });
  const lotsPath = join(args.outDir, "lots.json");
  const htmlPath = join(args.outDir, "city.html");
  await writeFile(lotsPath, `${JSON.stringify(lots, null, 2)}\n`, "utf8");
  await writeFile(htmlPath, renderCityHtml(lots, generatedAt), "utf8");
  console.log(`[render] ${lots.length} lots → ${htmlPath}`);
  for (const lot of lots) {
    console.log(
      `  ${lot.fullName.padEnd(32)} ${lot.buildingBand}${String(lot.buildingId).padStart(2, "0")}  ${lot.yard}`,
    );
  }
  return htmlPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRender().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
