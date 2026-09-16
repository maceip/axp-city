import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const gameRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(gameRoot, "..");
const spritesRoot = join(repoRoot, "assets", "city-sprites");
const lotsPath = join(repoRoot, "out", "lots.json");

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function axpStatic(): Plugin {
  return {
    name: "axp-static",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/lots.json" && existsSync(lotsPath)) {
          res.setHeader("content-type", TYPES[".json"]);
          createReadStream(lotsPath).pipe(res);
          return;
        }
        if (url.pathname.startsWith("/assets/sprites/")) {
          const rel = url.pathname.slice("/assets/sprites/".length);
          const file = resolve(spritesRoot, rel);
          if (file.startsWith(spritesRoot) && existsSync(file) && statSync(file).isFile()) {
            res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
            createReadStream(file).pipe(res);
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      const dest = join(repoRoot, "dist", "game", "assets", "sprites");
      cpSync(spritesRoot, dest, { recursive: true });
      if (existsSync(lotsPath)) {
        cpSync(lotsPath, join(repoRoot, "dist", "game", "lots.json"));
      }
    },
  };
}

export default defineConfig({
  root: gameRoot,
  base: "./",
  publicDir: false,
  plugins: [axpStatic()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: join(repoRoot, "dist", "game"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ["phaser"] },
      },
    },
  },
});
