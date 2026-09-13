import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { parseArgs } from "./args.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.outDir);
// Sprite sheets live next to the repo (assets/city-sprites/) and are
// referenced as /assets/sprites/ — same layout as the live site.
const spritesRoot = resolve("assets", "city-sprites");

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let base = root;
  let rel = url.pathname === "/" ? "/city.html" : url.pathname;
  if (rel === "/assets/sprites" || rel.startsWith("/assets/sprites/")) {
    base = spritesRoot;
    rel = rel.slice("/assets/sprites".length) || "/";
  }
  const file = normalize(join(base, rel));
  if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

server.listen(args.port, "127.0.0.1", () => {
  console.log(`AXP City preview http://127.0.0.1:${args.port}/`);
});
