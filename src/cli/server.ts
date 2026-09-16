import { readFile, mkdir, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, parseRepoLine } from "./args.js";
import { parseLot } from "../parser/parseLot.js";
import { loadFixtureRepositoryRules, loadLocalRules, repoName } from "../rules/load.js";
import { loadArtworkApprovals, resolveArtwork } from "../rules/artwork.js";
import {
  PrivateRepositoryError,
  resolveRepository,
  type ResolvedRepository,
} from "../live/repository.js";
import { createReconciler, httpAlerter } from "../live/reconcile.js";
import { tokenProviderFromEnv } from "../ingest/githubApp.js";
import { GITHUB_API_URL } from "../ingest/github.js";
import { consoleLogger, createWebhookServer } from "../webhooks/server.js";
import { LOOPBACK_PROXIES } from "../webhooks/rateLimit.js";
import type { CityLot, RepoMetrics } from "../types.js";

export interface ServerConfig {
  dev: boolean;
  offline: boolean;
  host: string;
  port: number;
  dataDir: string;
  rulesDir: string;
  allowUnsigned: boolean;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  trustedProxies: string[];
  staleAfterMs: number;
  refreshIntervalMs: number;
  enrollFile: string | undefined;
  backupDir: string | undefined;
  alertUrl: string | undefined;
  webhookSecretSet: boolean;
  adminTokenSet: boolean;
  githubCredential: "github-app" | "github-token" | "github-anonymous" | "fixture";
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive number, got ${raw}`);
  return value;
}

export function resolveConfig(argv: string[]): ServerConfig {
  const args = parseArgs(argv);
  const dev = argv.includes("--dev");
  const offline = args.offline || process.env.CITY_OFFLINE === "1";
  const host = process.env.HOST ?? args.host;
  const port = argv.includes("--port")
    ? args.port
    : Number(process.env.PORT ?? (dev ? 5173 : 43174));
  // Live and fixture state never share a database.
  const dataDir =
    process.env.CITY_DATA_DIR ?? (offline ? join("data", "offline") : "data");
  const trustedProxies = (process.env.CITY_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const enrollIndex = argv.indexOf("--enroll");
  const provider = offline ? "fixture" : tokenProviderFromEnv().kind;
  return {
    dev,
    offline,
    host,
    port,
    dataDir,
    rulesDir: process.env.CITY_RULES_DIR ?? ".city",
    allowUnsigned: argv.includes("--allow-unsigned"),
    rateLimitMax: argv.includes("--rate-limit-max")
      ? args.rateLimitMax
      : numberEnv("CITY_RATE_LIMIT_MAX", args.rateLimitMax),
    rateLimitWindowMs: argv.includes("--rate-limit-window-ms")
      ? args.rateLimitWindowMs
      : numberEnv("CITY_RATE_LIMIT_WINDOW_MS", args.rateLimitWindowMs),
    trustedProxies: trustedProxies.length ? trustedProxies : [...LOOPBACK_PROXIES],
    staleAfterMs: numberEnv("CITY_STALE_AFTER_MS", 45 * 60_000),
    refreshIntervalMs: numberEnv("CITY_REFRESH_INTERVAL_MS", 15 * 60_000),
    enrollFile:
      enrollIndex >= 0 && argv[enrollIndex + 1]
        ? argv[enrollIndex + 1]
        : process.env.CITY_ENROLL_FILE,
    backupDir: process.env.CITY_BACKUP_DIR,
    alertUrl: process.env.CITY_ALERT_URL,
    webhookSecretSet: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    adminTokenSet: Boolean(process.env.CITY_ADMIN_TOKEN),
    githubCredential: provider,
  };
}

async function readFixture(path: string): Promise<RepoMetrics[]> {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const rows: RepoMetrics[] = Array.isArray(raw) ? raw : raw.metrics;
  if (!Array.isArray(rows)) throw new Error(`Fixture ${path} has no metrics array`);
  return rows;
}

export async function runServer(argv = process.argv.slice(2)): Promise<void> {
  const config = resolveConfig(argv);
  const args = parseArgs(argv);
  const log = consoleLogger;
  if (config.allowUnsigned && !["127.0.0.1", "localhost", "::1"].includes(config.host))
    throw new Error("Unsigned development webhooks require a loopback host");
  if (!config.offline && !config.webhookSecretSet && !config.allowUnsigned)
    log("warn", "GITHUB_WEBHOOK_SECRET is not set; webhook deliveries will be rejected (reconciliation polling still runs)");
  if (!config.adminTokenSet)
    log("warn", "CITY_ADMIN_TOKEN is not set; administrative enrollment/removal is disabled");

  const fixturePath = process.env.CITY_FIXTURE_PATH ?? args.snapshotPath;
  const defaults = await loadLocalRules(config.rulesDir);
  const provider = tokenProviderFromEnv();
  const artworkDir = join(config.dataDir, "artwork");

  const resolveLot = async (
    name: string,
    previous?: RepoMetrics,
  ): Promise<ResolvedRepository> => {
    repoName(name);
    // Operator approvals (`approved-artwork.json`) are re-read on every refresh in both
    // modes, so approving artwork takes effect on the next delivery without a restart.
    if (!config.offline)
      return resolveRepository(name, {
        rulesDir: config.rulesDir,
        token: await provider.token(),
        previous,
        approvals: await loadArtworkApprovals(config.rulesDir),
        artworkCacheDir: artworkDir,
        defaults,
      });
    // Explicit fixture mode re-reads its file and rule directory on every
    // refresh so local demos and browser tests can exercise updates, including
    // per-repository rules under <rulesDir>/repos/<owner>/<name>/.
    const rows = await readFixture(fixturePath);
    const row = rows.find((item) => item.fullName.toLowerCase() === name.toLowerCase());
    if (!row) throw new Error(`Offline fixture has no repository ${name}`);
    // Same visibility rule as the live resolver: a row that turned private is withdrawn, not retried.
    if (row.isPrivate === true) throw new PrivateRepositoryError(name);
    const metrics: RepoMetrics = { ...row, source: "fixture", isPrivate: row.isPrivate ?? false };
    const local = await loadLocalRules(config.rulesDir);
    const rules = await loadFixtureRepositoryRules(name, config.rulesDir, local);
    const lot: CityLot = {
      ...parseLot(metrics, { rules: rules.rules }),
      rulesSource: rules.source,
    };
    const warnings = rules.warning ? [rules.warning] : [];
    // Custom artwork follows the same approval, hash and dimension checks as live mode;
    // the bytes come from the fixture's rule folder instead of the Contents API.
    const artworkRule = rules.rules.building.artwork;
    if (artworkRule) {
      // The fixture folder stands for the repository's `.city/` directory, so a
      // repository-relative path such as `.city/building.png` maps onto it.
      const folder = join(config.rulesDir, "repos", name);
      const fromFolder: typeof fetch = async () => {
        try {
          const bytes = await readFile(join(folder, artworkRule.path.replace(/^\.city\//, "")));
          return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-length": String(bytes.byteLength) } });
        } catch {
          return new Response(null, { status: 404 });
        }
      };
      const resolved = await resolveArtwork(name, artworkRule, await loadArtworkApprovals(config.rulesDir), artworkDir, undefined, fromFolder);
      if (resolved.artwork) lot.artwork = resolved.artwork;
      if (resolved.warning) warnings.push(resolved.warning);
    }
    if (warnings.length) lot.rulesWarning = warnings.join("; ");
    return { lot, metrics };
  };

  const vite = config.dev
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
    buildRevision = JSON.parse(await readFile("dist/build-info.json", "utf8")).commit;
  } catch {
    /* dev has no build */
  }
  await mkdir(config.dataDir, { recursive: true });
  const runtime = createWebhookServer(
    {
      secret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
      allowUnsigned: config.allowUnsigned,
      offline: config.offline,
      buildRevision,
      databasePath: join(config.dataDir, "city.sqlite"),
      logPath: join(config.dataDir, "city-events.jsonl"),
      cityMapPath: join(config.dataDir, "city-map.json"),
      adminToken: process.env.CITY_ADMIN_TOKEN ?? "",
      spritesRoot: resolve("assets/city-sprites"),
      artworkRoot: resolve(artworkDir),
      clientRoot: resolve("dist/game"),
      rateLimitMax: config.rateLimitMax,
      rateLimitWindowMs: config.rateLimitWindowMs,
      trustedProxies: config.trustedProxies,
      staleAfterMs: config.staleAfterMs,
      source: config.offline ? "fixture" : provider.kind,
      resolveRepository: resolveLot,
      log,
      frontend: vite
        ? (req, res, next) => {
            if (["/city", "/city/", "/city.html"].includes((req.url ?? "").split("?")[0]))
              req.url = "/";
            vite.middlewares(req, res, next);
          }
        : undefined,
    },
    config.port,
  );
  const { migrated } = await runtime.city.load();
  if (migrated) log("info", "imported legacy JSON city state into SQLite", { dataDir: config.dataDir });

  // Fixture mode seeds an empty city from the fixture; the live city is only
  // ever populated through the canonical resolver (enrollment), never from a
  // stale metrics export.
  if (config.offline && runtime.city.lots().length === 0) {
    const rows = await readFixture(fixturePath);
    await runtime.city.hydrate(
      rows.map((row) => parseLot({ ...row, source: "fixture" }, { rules: defaults })),
      {},
      rows.map((row) => ({ ...row, source: "fixture" as const, isPrivate: row.isPrivate ?? false })),
    );
  }

  await new Promise<void>((done, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(config.port, config.host, done);
  });
  const effective = {
    ...config,
    ...runtime.effectiveConfig,
    databasePath: runtime.city.path,
    githubApiUrl: config.offline ? null : GITHUB_API_URL,
    buildRevision,
  };
  log("info", `AXP City · Phaser 4 · ${config.offline ? "OFFLINE FIXTURES" : "LIVE"} · http://${config.host}:${config.port}/city`);
  log("info", "effective configuration", effective as unknown as Record<string, unknown>);

  // Enrollment: repositories listed in the enroll file join the city through
  // the resolver. Already enrolled lots are refreshed, not re-added.
  const enrollFile =
    config.enrollFile ??
    (!config.offline && runtime.city.lots().length === 0 ? "repos.txt" : undefined);
  if (enrollFile && !config.offline) {
    let lines: string[] = [];
    try {
      lines = (await readFile(enrollFile, "utf8")).split("\n");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      log("warn", `enroll file ${enrollFile} not found`);
    }
    for (const line of lines) {
      const parsed = parseRepoLine(line);
      if (!parsed) continue;
      const name = `${parsed.owner}/${parsed.name}`;
      if (runtime.city.row(name)) continue;
      try {
        await runtime.refreshRepository(name);
        log("info", `enrolled ${name}`);
      } catch (error) {
        log("warn", `enrollment of ${name} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const reconciler = createReconciler({
    city: runtime.city,
    refresh: (name) => runtime.refreshRepository(name),
    intervalMs: config.refreshIntervalMs,
    spacingMs: 250,
    log,
    enabled: !config.offline,
    alert: async (alert) => {
      log(alert.kind === "recovered" ? "info" : "warn", `ALERT ${alert.kind}: ${alert.message}`);
      if (config.alertUrl) await httpAlerter(config.alertUrl, fetch, log)(alert);
    },
  });
  runtime.startWorker();
  reconciler.start();

  const housekeeping = setInterval(() => {
    void (async () => {
      try {
        const pruned = runtime.city.prune();
        if (pruned.events || pruned.deliveries) log("info", "pruned retention", pruned);
        if (config.backupDir) {
          const stamp = new Date().toISOString().replaceAll(":", "").slice(0, 15);
          await runtime.city.backup(join(config.backupDir, `city-${stamp}.sqlite`));
          const files = (await readdir(config.backupDir))
            .filter((f) => /^city-.*\.sqlite$/.test(f))
            .sort();
          for (const old of files.slice(0, Math.max(0, files.length - 14)))
            await rm(join(config.backupDir, old));
        }
      } catch (error) {
        log("error", "housekeeping failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, 6 * 3_600_000);
  housekeeping.unref();

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    reconciler.stop();
    const drained = runtime.stopWorker();
    clearInterval(housekeeping);
    runtime.server.closeAllConnections();
    runtime.server.close(() => {
      const finish = () => {
        runtime.city.close();
        process.exit(0);
      };
      // Let the delivery in hand finish before the store closes; anything still queued
      // is re-queued on the next start.
      void drained.then(() => (vite ? vite.close().finally(finish) : finish()));
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
