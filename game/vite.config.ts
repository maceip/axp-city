import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { requiredSheets } from "../src/game/plan.js";
export default defineConfig({
  root: resolve("game"),
  base: "/",
  publicDir: false,
  server: { fs: { allow: [resolve(".")] } },
  plugins: [
    {
      name: "city-art",
      closeBundle() {
        const dest = resolve("dist/game/assets/sprites");
        mkdirSync(dest, { recursive: true });
        for (const file of requiredSheets())
          cpSync(resolve("assets/city-sprites", file), resolve(dest, file));
      },
    },
  ],
  build: {
    outDir: resolve("dist/game"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
    chunkSizeWarningLimit: 1800,
  },
});
