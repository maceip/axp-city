#!/usr/bin/env node
/**
 * Public verification of a deployed city.
 *
 *   node scripts/verify-city.mjs https://demo.glint.sh <expected-commit>
 *
 * Checks the liveness and readiness endpoints, the exact build revision, that
 * the served client bundle is the Phaser application and that every asset it
 * references resolves, that the snapshot, SVG export and SSE stream answer, and
 * that the stream delivers a snapshot event. Exit code 0 only when every check
 * passes; the JSON report goes to stdout (or --report <file>) for the deploy
 * pipeline to keep alongside the release.
 */
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const base = (argv.find((a) => !a.startsWith("--")) ?? process.env.CITY_URL ?? "http://127.0.0.1:43174").replace(/\/$/, "");
const expected = argv.filter((a) => !a.startsWith("--"))[1] ?? process.env.CITY_EXPECTED_REVISION;
const reportIndex = argv.indexOf("--report");
const reportPath = reportIndex >= 0 ? argv[reportIndex + 1] : undefined;
const timeout = Number(process.env.CITY_VERIFY_TIMEOUT_MS ?? 15_000);

const checks = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    checks.push({ name, ok: true, ms: Date.now() - started, detail });
  } catch (error) {
    checks.push({ name, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
  }
}

async function get(path, accept = "application/json") {
  const response = await fetch(base + path, { headers: { accept }, signal: AbortSignal.timeout(timeout), redirect: "manual" });
  return response;
}

await check("liveness", async () => {
  const r = await get("/healthz");
  if (!r.ok) throw new Error(`/healthz ${r.status}`);
  const body = await r.json();
  if (body.renderer !== "phaser-4") throw new Error(`renderer ${body.renderer}`);
  if (expected && body.buildRevision !== expected) throw new Error(`buildRevision ${body.buildRevision} != ${expected}`);
  return { buildRevision: body.buildRevision, lots: body.lots, mode: body.mode };
});

await check("readiness", async () => {
  const r = await get("/readyz");
  const body = await r.json().catch(() => ({}));
  if (r.status !== 200 || !body.ready) throw new Error(`/readyz ${r.status} ${JSON.stringify(body.checks ?? {})}`);
  return body.checks;
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
    if (!value?.includes(expectedValue)) throw new Error(`${name} missing ${expectedValue}`);
  }
  if (r.headers.get("cache-control") !== "no-cache") throw new Error("HTML must revalidate");
  html = await r.text();
  if (!/<div id="game"/.test(html)) throw new Error("index.html is not the Phaser client");
  if (/svg#axp-map|id="axp-map"/.test(html)) throw new Error("static SVG map markup is being served");
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (!assets.some((a) => a.endsWith(".js"))) throw new Error("no script bundle referenced");
  for (const asset of assets) {
    const a = await get(asset, "*/*");
    if (!a.ok) throw new Error(`${asset} ${a.status}`);
    if (!a.headers.get("cache-control")?.includes("immutable"))
      throw new Error(`${asset} is not immutable`);
  }
  return { assets, securityHeaders: Object.keys(requiredHeaders) };
});

await check("snapshot", async () => {
  const r = await get("/api/city");
  if (!r.ok) throw new Error(`/api/city ${r.status}`);
  const body = await r.json();
  if (body.version !== 1 || !Array.isArray(body.plan?.placements)) throw new Error("snapshot schema mismatch");
  const status = await (await get("/api/city/status")).json();
  return { revision: body.revision, lots: body.plan.placements.length, mode: body.mode, freshness: body.freshness, stale: status.stale, deliveries: status.deliveries };
});

await check("svg export and sprite sheets", async () => {
  const r = await get("/api/city/export.svg", "image/svg+xml");
  if (!r.ok) throw new Error(`/api/city/export.svg ${r.status}`);
  const text = await r.text();
  if (!text.startsWith("<svg") && !text.startsWith("<?xml")) throw new Error("not an SVG document");
  // The SVG references the same sprite sheets the Phaser client loads.
  const sheets = [...new Set([...text.matchAll(/href="(\/assets\/sprites\/[^"]+)"/g)].map((m) => m[1]))];
  if (!sheets.length) throw new Error("SVG export references no sprite sheets");
  for (const sheet of sheets) {
    const a = await fetch(base + sheet, { method: "HEAD", signal: AbortSignal.timeout(timeout) });
    if (!a.ok) throw new Error(`${sheet} ${a.status}`);
  }
  return { bytes: text.length, sheets };
});

await check("event stream", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(`${base}/api/city/stream`, { headers: { accept: "text/event-stream" }, signal: controller.signal });
    if (!r.ok || !r.headers.get("content-type")?.includes("text/event-stream")) throw new Error(`stream ${r.status} ${r.headers.get("content-type")}`);
    const reader = r.body.getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream closed before a snapshot event");
      buffer += new TextDecoder().decode(value);
      if (/event: snapshot/.test(buffer) || /"type":"snapshot"/.test(buffer)) break;
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
    headers: { "content-type": "application/json", "x-github-event": "ping", "x-github-delivery": `verify-${Date.now()}` },
    body: "{}",
    signal: AbortSignal.timeout(timeout),
  });
  if (r.status < 400 || r.status >= 500) throw new Error(`unsigned delivery answered ${r.status}`);
  return { status: r.status };
});

await check("admin requires token", async () => {
  const r = await fetch(`${base}/api/city/lots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: "example/none" }), signal: AbortSignal.timeout(timeout) });
  if (![401, 403, 404, 503].includes(r.status)) throw new Error(`anonymous admin call answered ${r.status}`);
  return { status: r.status };
});

const report = { url: base, expectedRevision: expected ?? null, verifiedAt: new Date().toISOString(), ok: checks.every((c) => c.ok), checks };
const text = JSON.stringify(report, null, 2);
if (reportPath) writeFileSync(reportPath, text);
console.log(text);
process.exit(report.ok ? 0 : 1);
