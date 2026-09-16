#!/usr/bin/env node
/**
 * Consistent copy of the live SQLite city store, verified before it is kept.
 *
 *   node scripts/backup-city.mjs <data-dir> <destination.sqlite>
 *
 * Uses `VACUUM INTO`, which snapshots a WAL database while the server keeps
 * writing, then opens the copy read-only and runs `PRAGMA integrity_check`
 * and a row count so a corrupt or empty backup is never reported as success.
 * Prints a JSON summary for the deploy and backup scripts.
 */
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [dataDir, destination] = process.argv.slice(2);
if (!dataDir || !destination) {
  console.error("usage: backup-city.mjs <data-dir> <destination.sqlite>");
  process.exit(2);
}
const source = join(resolve(dataDir), "city.sqlite");
if (!existsSync(source)) {
  console.error(`no city store at ${source}`);
  process.exit(3);
}
const target = resolve(destination);
mkdirSync(dirname(target), { recursive: true });
rmSync(target, { force: true });

const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
} finally {
  db.close();
}

const copy = new DatabaseSync(target, { readOnly: true });
try {
  const integrity = copy.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]);
  const lots = copy.prepare("SELECT COUNT(*) AS n FROM lots").get().n;
  const deliveries = copy.prepare("SELECT COUNT(*) AS n FROM deliveries").get().n;
  const ok = integrity.length === 1 && integrity[0] === "ok";
  const summary = { source, target, bytes: statSync(target).size, lots, deliveries, integrity: ok ? "ok" : integrity, backedUpAt: new Date().toISOString() };
  console.log(JSON.stringify(summary));
  if (!ok) {
    rmSync(target, { force: true });
    process.exit(1);
  }
} finally {
  copy.close();
}
