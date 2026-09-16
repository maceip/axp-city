import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./args.js";
import { parseLot } from "../parser/parseLot.js";
import { loadLocalRules, repoName } from "../rules/load.js";
import { resolveRepository } from "../live/repository.js";
import { createWebhookServer } from "../webhooks/server.js";
import type { RepoMetrics } from "../types.js";

export async function runServer(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const dev = argv.includes("--dev");
  const offline = args.offline || process.env.CITY_OFFLINE === "1";
  const host = process.env.HOST ?? args.host;
  const port = argv.includes("--port")
    ? args.port
    : Number(process.env.PORT ?? (dev ? 5173 : 43174));
  const dataDir = process.env.CITY_DATA_DIR ?? "data";
  const rulesDir = process.env.CITY_RULES_DIR ?? ".city";
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  const allowUnsigned = argv.includes("--allow-unsigned");
  if (allowUnsigned && !["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("Unsigned development webhooks require a loopback host");
  let metrics: RepoMetrics[] = [];
  const seedPath =
    process.env.CITY_FIXTURE_PATH ??
    (offline ? args.snapshotPath : join(args.outDir, "metrics.json"));
  try {
    const data = JSON.parse(await readFile(seedPath, "utf8"));
    metrics = Array.isArray(data) ? data : data.metrics;
    if (!Array.isArray(metrics)) throw new Error("Expected metrics array");
  } catch (error) {
    if (offline || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw error;
  }
  const resolveLot = async (name: string) => {
    repoName(name);
    if (!offline) return resolveRepository(name, rulesDir);
    // Explicit offline mode re-reads its fixture so local demos can exercise updates.
    const raw = JSON.parse(await readFile(seedPath, "utf8"));
    const rows: RepoMetrics[] = Array.isArray(raw) ? raw : raw.metrics;
    const row = rows.find(
      (item) => item.fullName.toLowerCase() === name.toLowerCase(),
    );
    if (!row) throw new Error(`Offline fixture has no repository ${name}`);
    return {
      ...parseLot(
        { ...row, source: "fixture" },
        { rules: await loadLocalRules(rulesDir) },
      ),
      rulesSource: "default" as const,
    };
  };
  const vite = dev
    ? await (
        await import("vite")
      ).createServer({
        configFile: "game/vite.config.ts",
        server: { middlewareMode: true },
        appType: "spa",
      })
    : undefined;
  let buildRevision = "development";
  try {
    buildRevision = JSON.parse(
      await readFile("dist/build-info.json", "utf8"),
    ).commit;
  } catch {
    /* dev has no build */
  }
  const runtime = createWebhookServer(
    {
      secret,
      allowUnsigned,
      offline,
      buildRevision,
      logPath: join(dataDir, "city-events.jsonl"),
      cityMapPath: join(dataDir, "city-map.json"),
      adminToken: process.env.CITY_ADMIN_TOKEN ?? "",
      spritesRoot: resolve("assets/city-sprites"),
      clientRoot: resolve("dist/game"),
      resolveRepository: resolveLot,
      frontend: vite
        ? (req, res, next) => {
            if (
              ["/city", "/city/", "/city.html"].includes(
                (req.url ?? "").split("?")[0],
              )
            )
              req.url = "/";
            vite.middlewares(req, res, next);
          }
        : undefined,
    },
    port,
  );
  await mkdir(dataDir, { recursive: true });
  await runtime.store.load();
  await runtime.city.load();
  const defaults = await loadLocalRules(rulesDir);
  // Bootstrap once. A server restart must never overwrite newer persisted lots with an old export.
  if (runtime.city.lots().length === 0 && metrics.length)
    await runtime.city.hydrate(
      metrics.map((row) => parseLot(row, { rules: defaults })),
    );
  await new Promise<void>((done, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(port, host, done);
  });
  console.log(
    `AXP City · Phaser 4 · ${offline ? "OFFLINE FIXTURES" : "LIVE"} · http://${host}:${port}/city`,
  );
  // Signed events remain the immediate update path. Authenticated reconciliation also ages quiet lots.
  let refreshing = false;
  const reconcile = async () => {
    if (refreshing || offline || !process.env.GITHUB_TOKEN) return;
    refreshing = true;
    try {
      for (const lot of runtime.city.lots()) {
        try {
          await runtime.refreshRepository(lot.fullName);
        } catch (error) {
          console.error(
            `[refresh] ${lot.fullName}: ${error instanceof Error ? error.message : "failed"}`,
          );
        }
      }
    } finally {
      refreshing = false;
    }
  };
  const timer = setInterval(() => {
    void reconcile();
  }, 15 * 60_000);
  void reconcile();
  const stop = () => {
    clearInterval(timer);
    runtime.server.closeAllConnections();
    runtime.server.close(() => {
      void vite?.close().finally(() => process.exit(0));
      if (!vite) process.exit(0);
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
