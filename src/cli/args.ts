export interface CliArgs {
  reposFile: string;
  outDir: string;
  fixturesDir: string;
  snapshotPath: string;
  offline: boolean;
  port: number;
  host: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

const DEFAULTS: CliArgs = {
  reposFile: "repos.txt",
  outDir: "out",
  fixturesDir: "fixtures/github",
  snapshotPath: "fixtures/github/batch.json",
  offline: false,
  port: 43173,
  host: "127.0.0.1",
  rateLimitMax: 120,
  rateLimitWindowMs: 60_000,
};

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--repos" && next) {
      out.reposFile = next;
      i += 1;
    } else if (arg === "--out" && next) {
      out.outDir = next;
      i += 1;
    } else if (arg === "--fixtures" && next) {
      out.fixturesDir = next;
      i += 1;
    } else if (arg === "--snapshot" && next) {
      out.snapshotPath = next;
      i += 1;
    } else if (arg === "--port" && next) {
      out.port = Number(next);
      i += 1;
    } else if (arg === "--host" && next) {
      out.host = next;
      i += 1;
    } else if (arg === "--rate-limit-max" && next) {
      out.rateLimitMax = Number(next);
      i += 1;
    } else if (arg === "--rate-limit-window-ms" && next) {
      out.rateLimitWindowMs = Number(next);
      i += 1;
    } else if (arg === "--offline") {
      out.offline = true;
    }
  }
  return out;
}

export function parseRepoLine(line: string): { owner: string; name: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const [owner, name] = trimmed.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo line (expected owner/name): ${line}`);
  }
  return { owner, name };
}
