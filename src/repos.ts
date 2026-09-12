import { readFile } from "node:fs/promises";
import { parseRepoLine } from "./cli/args.js";

export async function readRepoList(filePath: string): Promise<Array<{ owner: string; name: string }>> {
  const text = await readFile(filePath, "utf8");
  const out: Array<{ owner: string; name: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseRepoLine(line);
    if (parsed) out.push(parsed);
  }
  if (out.length === 0) {
    throw new Error(`No repos found in ${filePath}`);
  }
  return out;
}

export function fullNames(repos: Array<{ owner: string; name: string }>): string[] {
  return repos.map((r) => `${r.owner}/${r.name}`);
}
