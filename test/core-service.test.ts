import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
const exec = promisify(execFile);
const REVISION = "1234567890abcdef1234567890abcdef12345678";
async function verify(
  options: {
    legacy?: boolean;
    missingChunk?: boolean;
    exposeApi?: boolean;
    saveControl?: boolean;
    persistence?: string;
    revision?: string;
  } = {},
) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = req.url!;
    requests.push(`${req.method} ${path}`);
    const headers = {
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "cross-origin-opener-policy": "same-origin",
      "permissions-policy": "camera=()",
      "referrer-policy": "no-referrer",
      "strict-transport-security": "max-age=31536000",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    };
    for (const [name, value] of Object.entries(headers))
      res.setHeader(name, value);
    function reply(status: number, text: string, type = "application/json") {
      res.writeHead(status, { "content-type": type });
      res.end(text);
    }
    const health = {
      ready: true,
      renderer: "phaser-4",
      buildRevision: options.revision ?? REVISION,
      ...(options.legacy
        ? { lots: 1, mode: "offline", checks: { bundle: true } }
        : {
            experience: "core",
            integrations: false,
            persistence: options.persistence ?? "browser",
          }),
    };
    if (path === "/healthz" || path === "/readyz")
      return reply(200, JSON.stringify(health));
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (options.legacy) return reply(401, "{}");
      res.setHeader("allow", "GET, HEAD");
      return reply(405, "{}");
    }
    if (path === "/city") {
      res.setHeader("cache-control", "no-cache");
      return reply(
        200,
        `<html><div\n id="game"></div><button\n data-action="load">Load</button>${options.saveControl === false ? "" : '<button data-action="save">Save</button>'}<script type="module" src="/assets/index-test.js"></script></html>`,
        "text/html",
      );
    }
    if (path.startsWith("/assets/")) {
      if (options.missingChunk && path.includes("phaser"))
        return reply(404, "missing");
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
      if (path === "/assets/index-test.js")
        return reply(200, 'import("./config-test.js");', "text/javascript");
      if (path === "/assets/config-test.js")
        return reply(200, 'import "./phaser-test.js";', "text/javascript");
      if (path === "/assets/phaser-test.js")
        return reply(200, "export const Phaser = {};", "text/javascript");
      if (path === "/assets/sprites/mock.png")
        return reply(200, "image", "image/png");
      return reply(404, "missing");
    }
    if (options.legacy || options.exposeApi) {
      if (path === "/api/city")
        return reply(
          200,
          JSON.stringify({ version: 1, revision: 1, plan: { placements: [] } }),
        );
      if (path === "/api/city/status") return reply(200, "{}");
      if (path === "/api/city/export.svg")
        return reply(
          200,
          '<svg><image href="/assets/sprites/mock.png"/></svg>',
          "image/svg+xml",
        );
      if (path === "/api/city/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("event: snapshot\ndata: {}\n\n");
        return;
      }
    }
    reply(404, "{}");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const dir = await mkdtemp(join(tmpdir(), "core-verifier-")),
    report = join(dir, "report.json");
  let exitCode = 0;
  try {
    await exec(
      process.execPath,
      [
        resolve("scripts/verify-city.mjs"),
        `http://127.0.0.1:${address.port}`,
        REVISION,
        "--report",
        report,
      ],
      { env: { ...process.env, CITY_VERIFY_TIMEOUT_MS: "3000" } },
    ).catch((error) => {
      exitCode = error.code;
    });
    return {
      exitCode,
      report: JSON.parse(await readFile(report, "utf8")),
      requests,
    };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
}

describe("core service verification", () => {
  it("recognizes multiline Phaser markup, follows lazy chunks and verifies the core contract", async () => {
    const result = await verify();
    expect(result.exitCode).toBe(0);
    expect(result.report.ok).toBe(true);
    expect(result.report.experience).toBe("core");
    expect(result.requests).toContain("GET /assets/config-test.js");
    expect(result.requests).toContain("GET /assets/phaser-test.js");
    expect(result.requests).toContain("DELETE /api/city/lots/example");
    expect(
      result.report.checks.map((c: { name: string }) => c.name),
    ).not.toContain("snapshot");
  });
  it.each([
    ["missing lazy Phaser chunk", { missingChunk: true }],
    ["exposed integration API", { exposeApi: true }],
    ["missing save control", { saveControl: false }],
    ["server persistence", { persistence: "sqlite" }],
    ["wrong build", { revision: "wrong" }],
  ])("rejects %s", async (_name, options) => {
    const result = await verify(options);
    expect(result.exitCode).toBe(1);
    expect(result.report.ok).toBe(false);
  });
  it("retains the snapshot, export and event stream checks for the explicit integration service", async () => {
    const result = await verify({ legacy: true });
    expect(result.exitCode).toBe(0);
    expect(result.report.experience).toBe("integration");
    expect(result.report.checks.map((c: { name: string }) => c.name)).toContain(
      "event stream",
    );
  });
});

describe("service entry point", () => {
  it("executes core before credential lookup and keeps explicit legacy opt-in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "core-start-"));
    try {
      await writeFile(join(dir, "node"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
        mode: 0o755,
      });
      await writeFile(
        join(dir, "gh"),
        '#!/bin/sh\necho "called" > "$CORE_TEST_GH_CALL_FILE"\nexit 1\n',
        { mode: 0o755 },
      );
      const env = {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CITY_ALLOW_GH_CLI_TOKEN: "1",
        GITHUB_APP_ID: "",
        GITHUB_TOKEN: "",
        CITY_OFFLINE: "0",
        CITY_INTEGRATIONS: "0",
        CORE_TEST_GH_CALL_FILE: join(dir, "credential-lookup"),
      };
      const core = await exec(
        "/bin/bash",
        [resolve("scripts/start-city.sh"), "--port", "43210"],
        { env },
      );
      expect(core.stdout.trim().split("\n")).toEqual([
        "dist/server/cli/server.js",
        "--core",
        "--port",
        "43210",
      ]);
      expect(core.stderr).toBe("");
      await expect(
        readFile(env.CORE_TEST_GH_CALL_FILE, "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const legacy = await exec(
        "/bin/bash",
        [resolve("scripts/start-city.sh"), "--port", "43210"],
        { env: { ...env, CITY_INTEGRATIONS: "1" } },
      );
      expect(legacy.stdout.trim().split("\n")).toEqual([
        "dist/server/cli/server.js",
        "--port",
        "43210",
      ]);
      expect(await readFile(env.CORE_TEST_GH_CALL_FILE, "utf8")).toBe(
        "called\n",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
