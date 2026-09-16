import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderCitySvg } from "../export/svg.js";
import type { CitySnapshot } from "../live/protocol.js";
import { requiredSheets } from "../game/plan.js";

export interface ExportOptions {
  /** Running city to snapshot, e.g. http://127.0.0.1:8787. */
  from?: string;
  /** Or a saved snapshot JSON (`/api/city/export.json`). */
  snapshot?: string;
  out: string;
  clientRoot: string;
  spritesRoot: string;
}

function parse(argv: string[]): ExportOptions {
  const options: ExportOptions = {
    out: "out/offline",
    clientRoot: "dist/game",
    spritesRoot: "assets/city-sprites",
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const value = inline ?? argv[++i];
    switch (flag) {
      case "--from":
        options.from = value;
        break;
      case "--snapshot":
        options.snapshot = value;
        break;
      case "--out":
        options.out = value;
        break;
      case "--client":
        options.clientRoot = value;
        break;
      case "--sprites":
        options.spritesRoot = value;
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  return options;
}

async function loadSnapshot(options: ExportOptions): Promise<CitySnapshot> {
  if (options.snapshot) return JSON.parse(readFileSync(options.snapshot, "utf8")) as CitySnapshot;
  const base = options.from ?? process.env.CITY_URL ?? "http://127.0.0.1:8787";
  const response = await fetch(`${base.replace(/\/$/, "")}/api/city/export.json`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`City at ${base} returned ${response.status}`);
  return (await response.json()) as CitySnapshot;
}

/**
 * Builds a self-contained directory with the compiled Phaser game, the sprite
 * kit, the saved city snapshot and its SVG export. Opening `index.html` from
 * any static file host (or a browser's file:// URL) shows the saved city with
 * no network access: the client reads `city.json` instead of the live API.
 */
export async function runExport(argv = process.argv.slice(2)): Promise<string> {
  const options = parse(argv);
  const client = resolve(options.clientRoot);
  if (!existsSync(join(client, "index.html"))) throw new Error(`No built client at ${client}; run npm run build first`);
  const snapshot = await loadSnapshot(options);
  if (snapshot.version !== 1 || !Array.isArray(snapshot.plan?.placements)) throw new Error("Snapshot is not a city export");
  const out = resolve(options.out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(client, out, { recursive: true });
  const sprites = join(out, "assets", "sprites");
  mkdirSync(sprites, { recursive: true });
  for (const file of requiredSheets()) {
    const source = resolve(options.spritesRoot, file);
    if (existsSync(source)) cpSync(source, join(sprites, file));
  }
  // Approved artwork referenced by lots is bundled too.
  for (const place of snapshot.plan.placements) {
    const art = place.lot.artwork;
    if (!art) continue;
    const base = options.from ?? process.env.CITY_URL;
    if (!base) continue;
    try {
      const response = await fetch(`${base.replace(/\/$/, "")}${art.url}`);
      if (response.ok) {
        const target = join(out, art.url.replace(/^\//, ""));
        mkdirSync(resolve(target, ".."), { recursive: true });
        writeFileSync(target, Buffer.from(await response.arrayBuffer()));
        art.url = `./${art.url.replace(/^\//, "")}`;
      }
    } catch {
      // Missing artwork falls back to the catalog building in the client.
    }
  }
  const saved: CitySnapshot = {
    ...snapshot,
    mode: "offline",
    freshness: { ...snapshot.freshness, source: "fixture" },
  };
  writeFileSync(join(out, "city.json"), JSON.stringify(saved));
  writeFileSync(join(out, "city.svg"), renderCitySvg(snapshot, { assetBase: "./assets/sprites/", title: `AXP City — saved revision ${snapshot.revision}` }));
  let html = readFileSync(join(out, "index.html"), "utf8");
  html = html
    .replace(/(src|href)="\/assets\//g, '$1="./assets/')
    .replace(
      "</title>",
      `</title>\n    <meta name="city-offline" content="./city.json" />\n    <meta name="city-asset-base" content="./assets/sprites" />\n    <meta name="city-svg" content="./city.svg" />`,
    );
  writeFileSync(join(out, "index.html"), html);
  writeFileSync(
    join(out, "README.txt"),
    [
      `AXP City offline package`,
      `Saved ${snapshot.serverTime}, revision ${snapshot.revision}, ${snapshot.plan.placements.length} lots.`,
      ``,
      `Open index.html from any static file server, for example:`,
      `  python3 -m http.server 8080  (then http://localhost:8080/)`,
      `The package needs no network access: city.json holds the saved city and`,
      `assets/sprites holds the artwork. city.svg is a still rendering of the same plan.`,
    ].join("\n"),
  );
  console.log(`[export] offline package with ${snapshot.plan.placements.length} lots at ${out}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`)
  void runExport().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
