#!/usr/bin/env node
/**
 * Public verification of a deployed city.
 *
 *   node scripts/verify-city.mjs https://demo.glint.sh <expected-commit>
 *
 * Checks the liveness and readiness endpoints, the exact build revision, that
 * the served client bundle is the Phaser application and that every asset it
 * references resolves. Core mode checks browser-save controls and the absence
 * of integration APIs; the explicitly enabled integration service retains its
 * snapshot, SVG and SSE checks. Exit code 0 only when every check
 * passes; the JSON report goes to stdout (or --report <file>) for the deploy
 * pipeline to keep alongside the release.
 */
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const reportIndex = argv.indexOf("--report");
const reportPath = reportIndex >= 0 ? argv[reportIndex + 1] : undefined;
if (reportIndex >= 0 && (!reportPath || reportPath.startsWith("--")))
  throw new Error("--report requires a file path");
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && (reportIndex < 0 || i !== reportIndex + 1),
);
const base = (
  positional[0] ??
  process.env.CITY_URL ??
  "http://127.0.0.1:43174"
).replace(/\/$/, "");
const expected = positional[1] ?? process.env.CITY_EXPECTED_REVISION;
const timeout = Number(process.env.CITY_VERIFY_TIMEOUT_MS ?? 15_000);

const checks = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    checks.push({ name, ok: true, ms: Date.now() - started, detail });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function get(path, accept = "application/json") {
  const response = await fetch(base + path, {
    headers: { accept },
    signal: AbortSignal.timeout(timeout),
    redirect: "manual",
  });
  return response;
}

let experience = "integration";
await check("liveness", async () => {
  const r = await get("/healthz");
  if (!r.ok) throw new Error(`/healthz ${r.status}`);
  const body = await r.json();
  if (body.renderer !== "phaser-4")
    throw new Error(`renderer ${body.renderer}`);
  if (typeof body.buildRevision !== "string" || !body.buildRevision.length)
    throw new Error("missing buildRevision");
  if (expected && body.buildRevision !== expected)
    throw new Error(`buildRevision ${body.buildRevision} != ${expected}`);
  if (body.experience === "core") {
    experience = "core";
    if (body.integrations !== false || body.persistence !== "browser")
      throw new Error(
        "core must use browser persistence with integrations disabled",
      );
  }
  return {
    buildRevision: body.buildRevision,
    experience,
    persistence: body.persistence,
    integrations: body.integrations,
    lots: body.lots,
    mode: body.mode,
  };
});

await check("readiness", async () => {
  const r = await get("/readyz");
  const body = await r.json().catch(() => ({}));
  if (r.status !== 200 || !body.ready)
    throw new Error(`/readyz ${r.status} ${JSON.stringify(body.checks ?? {})}`);
  if (
    experience === "core" &&
    (body.experience !== "core" ||
      body.integrations !== false ||
      body.persistence !== "browser")
  )
    throw new Error("readiness does not describe the core workshop");
  if (
    experience === "core" &&
    (body.renderer !== "phaser-4" ||
      (expected && body.buildRevision !== expected))
  )
    throw new Error(
      "readiness renderer or build revision differs from the expected core build",
    );
  return body.checks ?? { ready: body.ready, experience: body.experience };
});

let html = "";
await check("client bundle", async () => {
  const r = await get("/city", "text/html");
  if (!r.ok) throw new Error(`/city ${r.status}`);
  const requiredHeaders = {
    "content-security-policy": "frame-ancestors 'none'",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=()",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
  for (const [name, expectedValue] of Object.entries(requiredHeaders)) {
    const value = r.headers.get(name);
    if (!value?.includes(expectedValue))
      throw new Error(`${name} missing ${expectedValue}`);
  }
  if (r.headers.get("cache-control") !== "no-cache")
    throw new Error("HTML must revalidate");
  html = await r.text();
  if (!/<div\b[^>]*\bid\s*=\s*["']game["']/i.test(html))
    throw new Error("index.html is not the Phaser client");
  if (/svg#axp-map|id="axp-map"/.test(html))
    throw new Error("static SVG map markup is being served");
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)\s*=\s*["'](\/assets\/[^"']+)["']/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  if (!assets.some((a) => a.endsWith(".js")))
    throw new Error("no script bundle referenced");
  const checked = new Set();
  for (let i = 0; i < assets.length; i++) {
    if (assets.length > 256)
      throw new Error("client references too many assets");
    const asset = assets[i];
    if (checked.has(asset)) continue;
    checked.add(asset);
    const a = await get(asset, "*/*");
    if (!a.ok) throw new Error(`${asset} ${a.status}`);
    if (!a.headers.get("cache-control")?.includes("immutable"))
      throw new Error(`${asset} is not immutable`);
    const type = a.headers.get("content-type") ?? "";
    if (asset.endsWith(".js") && !/javascript/.test(type))
      throw new Error(`${asset} is not JavaScript`);
    if (asset.endsWith(".css") && !/text\/css/.test(type))
      throw new Error(`${asset} is not CSS`);
    if (type.includes("text/html")) throw new Error(`${asset} returned HTML`);
    if (!/\.(?:js|css)$/.test(asset)) {
      await a.arrayBuffer();
      continue;
    }
    const text = await a.text();
    const references = [
      ...[
        ...text.matchAll(
          /["']((?:\.{1,2}\/|\/assets\/|assets\/)[^"'<>\s\\]+\.(?:js|css|ttf|woff2|png))["']/g,
        ),
      ].map((m) => m[1]),
      ...[
        ...text.matchAll(
          /url\(\s*["']?((?:\.{1,2}\/|\/assets\/)[^"')\s]+)["']?\s*\)/g,
        ),
      ].map((m) => m[1]),
    ];
    for (const reference of references) {
      const resolved = new URL(
        reference.startsWith("assets/") ? `/${reference}` : reference,
        base + asset,
      );
      if (
        resolved.origin !== new URL(base).origin ||
        !resolved.pathname.startsWith("/assets/")
      )
        throw new Error(`unexpected client asset ${reference}`);
      if (!assets.includes(resolved.pathname)) assets.push(resolved.pathname);
    }
  }
  if (experience === "core") {
    if (!assets.some((asset) => /\/phaser-[\w-]+\.js$/.test(asset)))
      throw new Error("core entry does not load the Phaser engine");
    for (const action of ["save", "load"]) {
      if (
        !new RegExp(
          `<button\\b[^>]*\\bdata-action\\s*=\\s*["']${action}["']`,
          "i",
        ).test(html)
      )
        throw new Error(`missing ${action} town control`);
    }
  }
  return { assets, securityHeaders: Object.keys(requiredHeaders) };
});

if (experience === "core") {
  await check("core has no integration APIs", async () => {
    const paths = [
      "/api/city",
      "/api/city/status",
      "/api/city/stream",
      "/api/city/export.svg",
      "/events",
      "/status",
    ];
    for (const path of paths) {
      const r = await get(path);
      if (r.status !== 404)
        throw new Error(`${path} must be absent, answered ${r.status}`);
      await r.arrayBuffer();
    }
    return { persistence: "browser", integrations: false, absent: paths };
  });
  await check("core rejects server mutations", async () => {
    const attempts = [
      ["POST", "/api/city/lots"],
      ["POST", "/webhooks/github"],
      ["PUT", "/city"],
      ["DELETE", "/api/city/lots/example"],
    ];
    for (const [method, path] of attempts) {
      const r = await fetch(base + path, {
        method,
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(timeout),
        redirect: "manual",
      });
      if (r.status !== 405 || r.headers.get("allow") !== "GET, HEAD")
        throw new Error(
          `${method} ${path} must reject mutations with 405 and GET, HEAD, answered ${r.status}`,
        );
      await r.arrayBuffer();
    }
    return { attempts: attempts.length, status: 405 };
  });
} else {
  await check("snapshot", async () => {
    const r = await get("/api/city");
    if (!r.ok) throw new Error(`/api/city ${r.status}`);
    const body = await r.json();
    if (body.version !== 1 || !Array.isArray(body.plan?.placements))
      throw new Error("snapshot schema mismatch");
    const status = await (await get("/api/city/status")).json();
    return {
      revision: body.revision,
      lots: body.plan.placements.length,
      mode: body.mode,
      freshness: body.freshness,
      stale: status.stale,
      deliveries: status.deliveries,
    };
  });

  await check("svg export and sprite sheets", async () => {
    const r = await get("/api/city/export.svg", "image/svg+xml");
    if (!r.ok) throw new Error(`/api/city/export.svg ${r.status}`);
    const text = await r.text();
    if (!text.startsWith("<svg") && !text.startsWith("<?xml"))
      throw new Error("not an SVG document");
    // The SVG references the same sprite sheets the Phaser client loads.
    const sheets = [
      ...new Set(
        [...text.matchAll(/href="(\/assets\/sprites\/[^"]+)"/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    if (!sheets.length)
      throw new Error("SVG export references no sprite sheets");
    for (const sheet of sheets) {
      const a = await fetch(base + sheet, {
        method: "HEAD",
        signal: AbortSignal.timeout(timeout),
      });
      if (!a.ok) throw new Error(`${sheet} ${a.status}`);
    }
    return { bytes: text.length, sheets };
  });

  await check("event stream", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await fetch(`${base}/api/city/stream`, {
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (
        !r.ok ||
        !r.headers.get("content-type")?.includes("text/event-stream")
      )
        throw new Error(`stream ${r.status} ${r.headers.get("content-type")}`);
      const reader = r.body.getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream closed before a snapshot event");
        buffer += new TextDecoder().decode(value);
        if (/event: snapshot/.test(buffer) || /"type":"snapshot"/.test(buffer))
          break;
      }
      return { firstBytes: buffer.length };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  });

  await check("webhook rejects unsigned", async () => {
    const r = await fetch(`${base}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "ping",
        "x-github-delivery": `verify-${Date.now()}`,
      },
      body: "{}",
      signal: AbortSignal.timeout(timeout),
    });
    if (r.status < 400 || r.status >= 500)
      throw new Error(`unsigned delivery answered ${r.status}`);
    return { status: r.status };
  });

  await check("admin requires token", async () => {
    const r = await fetch(`${base}/api/city/lots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "example/none" }),
      signal: AbortSignal.timeout(timeout),
    });
    if (![401, 403, 404, 503].includes(r.status))
      throw new Error(`anonymous admin call answered ${r.status}`);
    return { status: r.status };
  });
}

const report = {
  url: base,
  experience,
  expectedRevision: expected ?? null,
  verifiedAt: new Date().toISOString(),
  ok: checks.every((c) => c.ok),
  checks,
};
const text = JSON.stringify(report, null, 2);
if (reportPath) writeFileSync(reportPath, text);
console.log(text);
process.exit(report.ok ? 0 : 1);
