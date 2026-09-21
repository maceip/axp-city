import { resolve } from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: resolve("game"),
  base: "/",
  publicDir: false,
  server: { fs: { allow: [resolve(".")] } },
  build: {
    outDir: resolve("dist/game"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
    chunkSizeWarningLimit: 1800,
  },
});
