import { join } from "node:path";
import { parseArgs } from "./args.js";
import { createWebhookServer } from "../webhooks/index.js";

function installFatalGuards(): void {
  // A public catcher must never keep running after an unexpected fault:
  // log the cause and exit so the supervisor restarts a clean process,
  // which then replays data/city-events.jsonl and resumes without loss.
  const fatal = (cause: unknown): void => {
    console.error("[webhooks] fatal:", cause);
    process.exit(1);
  };
  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);
}

export async function runWebhooks(argv = process.argv.slice(2)): Promise<void> {
  installFatalGuards();
  const args = parseArgs(argv);
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  const allowUnsigned = argv.includes("--allow-unsigned");
  if (!secret && !allowUnsigned) {
    console.error(
      "[webhooks] missing GITHUB_WEBHOOK_SECRET. " +
        "Set it to the secret configured on GitHub, or pass --allow-unsigned for local dev only.",
    );
    process.exit(1);
  }
  if (allowUnsigned && secret) {
    console.error("[webhooks] --allow-unsigned is inert while a secret is set; verifying signatures.");
  }
  if (allowUnsigned && !secret) {
    console.error("[webhooks] WARNING: accepting unsigned deliveries (local dev only).");
  }
  const port = args.port === 43173 ? 43174 : args.port;
  const host = args.host;
  const { server, store } = createWebhookServer(
    {
      secret,
      allowUnsigned,
      logPath: join("data", "city-events.jsonl"),
      rateLimitMax: args.rateLimitMax,
      rateLimitWindowMs: args.rateLimitWindowMs,
    },
    port,
  );
  const replayed = await store.load();
  console.log(
    `[webhooks] replayed ${replayed.loaded} events` +
      (replayed.skipped > 0 ? ` (${replayed.skipped} corrupt lines skipped)` : ""),
  );
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  console.log(`[webhooks] listening on ${host}:${port} → POST /webhooks/github`);
  console.log("[webhooks] live feed: GET /events/stream · backlog: GET /events?limit=50");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWebhooks().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
