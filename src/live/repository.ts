import { fetchRepoMetrics } from "../ingest/github.js";
import { parseLot } from "../parser/parseLot.js";
import {
  loadLocalRules,
  loadRepositoryRules,
  repoName,
} from "../rules/load.js";
import type { CityLot } from "../types.js";
export async function resolveRepository(
  fullName: string,
  rulesDir = ".city",
  token = process.env.GITHUB_TOKEN,
): Promise<CityLot> {
  repoName(fullName);
  const [owner, name] = fullName.split("/");
  const defaults = await loadLocalRules(rulesDir);
  const [metrics, configuration] = await Promise.all([
    fetchRepoMetrics([{ owner, name }], { token }),
    loadRepositoryRules(fullName, defaults, token),
  ]);
  return {
    ...parseLot(metrics[0], { rules: configuration.rules }),
    rulesSource: configuration.source,
    rulesWarning: configuration.warning,
  };
}
