import { parseArgs } from "./args.js";
import { runIngest } from "./ingest.js";
import { runRender } from "./render.js";

export async function runDemo(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  console.log(`[demo] repos=${args.reposFile} offline=${args.offline}`);
  await runIngest(argv);
  await runRender(argv);
  console.log("[demo] done — open out/city.html");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
