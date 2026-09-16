import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_RULES,
  CityRulesError,
  parseBuildingRules,
  parseLoadingZoneRules,
  type CityRules,
} from "./cityFiles.js";

/** Rule files larger than this are rejected before their bodies are parsed. */
export const RULE_FILE_MAX_BYTES = 65_536;

export function repoName(value: string): string {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(value) ||
    value.split("/")[1] === "." ||
    value.split("/")[1] === ".."
  )
    throw new Error("Invalid repository; expected owner/name");
  return value;
}

export async function loadLocalRules(root = ".city"): Promise<CityRules> {
  async function read(file: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(join(root, file), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }
  return {
    building: parseBuildingRules(await read("building.json")),
    loadingZone: parseLoadingZoneRules(await read("loading-zone.json")),
  };
}

export class RuleFileTooLargeError extends Error {
  constructor(file: string) {
    super(`${file} exceeds ${RULE_FILE_MAX_BYTES} bytes`);
    this.name = "RuleFileTooLargeError";
  }
}

function isAuthorError(error: unknown): error is Error {
  return (
    error instanceof SyntaxError ||
    error instanceof CityRulesError ||
    error instanceof RuleFileTooLargeError
  );
}

export interface RepositoryRules {
  rules: CityRules;
  source: "default" | "repository";
  warning?: string;
}

export async function loadRepositoryRules(
  fullName: string,
  defaults = DEFAULT_RULES,
  token?: string,
  request: typeof fetch = fetch,
): Promise<RepositoryRules> {
  repoName(fullName);
  let count = 0;
  const warnings: string[] = [];
  async function read(file: string): Promise<unknown> {
    const response = await request(
      `https://api.github.com/repos/${fullName}/contents/.city/${file}`,
      {
        headers: {
          Accept: "application/vnd.github.raw+json",
          "User-Agent": "axp-city",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`GitHub rules HTTP ${response.status}`);
    // Reject oversized files from the declared length before buffering, then
    // re-check the actual byte length (not string length) once read.
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > RULE_FILE_MAX_BYTES) {
      await response.body?.cancel();
      throw new RuleFileTooLargeError(file);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > RULE_FILE_MAX_BYTES)
      throw new RuleFileTooLargeError(file);
    count++;
    return JSON.parse(bytes.toString("utf8"));
  }
  let building = defaults.building;
  let loadingZone = defaults.loadingZone;
  // Invalid author configuration uses validated defaults and an explicit warning.
  // Transport/auth failures fail the refresh, retaining the last good state.
  try {
    building = parseBuildingRules(await read("building.json"), building);
  } catch (e) {
    if (isAuthorError(e)) warnings.push(`building.json: ${e.message}`);
    else throw e;
  }
  try {
    loadingZone = parseLoadingZoneRules(
      await read("loading-zone.json"),
      loadingZone,
    );
  } catch (e) {
    if (isAuthorError(e)) warnings.push(`loading-zone.json: ${e.message}`);
    else throw e;
  }
  return {
    rules: { building, loadingZone },
    source: count ? "repository" : "default",
    ...(warnings.length ? { warning: warnings.join("; ") } : {}),
  };
}
