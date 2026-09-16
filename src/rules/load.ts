import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_RULES,
  CityRulesError,
  parseBuildingRules,
  parseLoadingZoneRules,
  type CityRules,
} from "./cityFiles.js";

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
export async function loadRepositoryRules(
  fullName: string,
  defaults = DEFAULT_RULES,
  token?: string,
  request: typeof fetch = fetch,
): Promise<{
  rules: CityRules;
  source: "default" | "repository";
  warning?: string;
}> {
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
    const text = await response.text();
    if (text.length > 65_536) throw new Error("Rule file exceeds 64 KiB");
    count++;
    return JSON.parse(text);
  }
  let building = defaults.building;
  let loadingZone = defaults.loadingZone;
  // Invalid author configuration uses validated defaults and an explicit warning.
  // Transport/auth failures fail the refresh, retaining the last good state.
  try {
    building = parseBuildingRules(await read("building.json"), building);
  } catch (e) {
    if (
      e instanceof SyntaxError ||
      (e instanceof Error &&
        (e instanceof CityRulesError || e.message.includes("64 KiB")))
    )
      warnings.push(`building.json: ${e.message}`);
    else throw e;
  }
  try {
    loadingZone = parseLoadingZoneRules(
      await read("loading-zone.json"),
      loadingZone,
    );
  } catch (e) {
    if (
      e instanceof SyntaxError ||
      (e instanceof Error &&
        (e instanceof CityRulesError || e.message.includes("64 KiB")))
    )
      warnings.push(`loading-zone.json: ${e.message}`);
    else throw e;
  }
  return {
    rules: { building, loadingZone },
    source: count ? "repository" : "default",
    ...(warnings.length ? { warning: warnings.join("; ") } : {}),
  };
}
