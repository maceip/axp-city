import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { parseArgs } from "./args.js";

/** The core workshop has no server-side city, integration jobs or credentials.
 * Its one authoritative WorldState is explicitly saved by the user in the browser.
 * The existing integration service and databases remain available separately to
 * migration/operations tools; serving the core never opens or migrates them.
 */
export async function runCoreServer(argv: string[]): Promise<void> {
  const args = parseArgs(argv),
    dev = argv.includes("--dev");
  const host = process.env.HOST ?? args.host;
  const port = argv.includes("--port")
    ? args.port
    : Number(process.env.PORT ?? (dev ? 5173 : 43174));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer from 1 to 65535.");
  const root = resolve("dist/game");
  const vite = dev
    ? await (
        await import("vite")
      ).createServer({
        configFile: "game/vite.config.ts",
        server: { middlewareMode: true },
        appType: "spa",
      })
    : undefined;
  let revision = "development";
  try {
    revision = JSON.parse(
      await readFile("dist/build-info.json", "utf8"),
    ).commit;
  } catch {
    /* dev */
  }
  const server = createServer(async (req, res) => {
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; base-uri 'self'; connect-src 'self'" +
        (dev ? " ws:" : "") +
        "; font-src 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    );
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cross-origin-opener-policy", "same-origin");
    res.setHeader(
      "permissions-policy",
      "camera=(), geolocation=(), microphone=()",
    );
    res.setHeader("cache-control", "no-store");
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" });
        res.end("Method not allowed");
        return;
      }
      const path = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      if (path === "/healthz" || path === "/readyz") {
        const ready = Boolean(vite || existsSync(resolve(root, "index.html")));
        res.writeHead(path === "/readyz" && !ready ? 503 : 200, {
          "content-type": "application/json",
        });
        res.end(
          req.method === "HEAD"
            ? undefined
            : JSON.stringify({
                ok: true,
                ready,
                renderer: "phaser-4",
                experience: "core",
                persistence: "browser",
                integrations: false,
                buildRevision: revision,
              }),
        );
        return;
      }
      if (vite) {
        vite.middlewares(req, res, () => {
          res.writeHead(404);
          res.end("Not found");
        });
        return;
      }
      const entry = [
        "/",
        "/city",
        "/city/",
        "/city.html",
        "/index.html",
      ].includes(path);
      if (!entry && !path.startsWith("/assets/")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const file = await realpath(
        resolve(root, entry ? "index.html" : path.slice(1)),
      );
      const base = await realpath(root);
      if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".ttf": "font/ttf",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
        "cache-control": entry
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      });
      if (req.method === "HEAD") res.end();
      else
        createReadStream(file)
          .on("error", () => res.destroy())
          .pipe(res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const code =
        error instanceof URIError
          ? 400
          : (error as NodeJS.ErrnoException).code === "ENOENT"
            ? 404
            : 500;
      res.writeHead(code);
      res.end(
        code === 400
          ? "Bad request"
          : code === 404
            ? "Not found"
            : "Unable to serve the town",
      );
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, host, done);
  });
  console.info(
    `AXP City · town workshop · http://${host}:${port}/city · browser saves; integrations off`,
  );
  const stop = () => {
    server.closeAllConnections();
    server.close(() => {
      void (vite ? vite.close() : Promise.resolve()).finally(() =>
        process.exit(0),
      );
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
