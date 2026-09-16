import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { CityRulesError, type ApprovedArtwork, type ArtworkRule } from "./cityFiles.js";
import { repoName } from "./load.js";

/** Hard cap for custom building PNGs. */
export const ARTWORK_MAX_BYTES = 512 * 1024;
export const ARTWORK_URL_PREFIX = "/assets/artwork/";

export interface ArtworkApproval {
  repo: string;
  sha256: string;
}

export interface ArtworkApprovals {
  version: 1;
  approved: ArtworkApproval[];
}

/** Parse `.city/approved-artwork.json`; the operator-controlled allow list. */
export function parseArtworkApprovals(raw: unknown): ArtworkApprovals {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new CityRulesError("approved-artwork must be an object");
  const input = raw as Record<string, unknown>;
  if (input.version !== 1)
    throw new CityRulesError("approved-artwork version must be 1");
  const list = input.approved ?? [];
  if (!Array.isArray(list))
    throw new CityRulesError("approved-artwork.approved must be an array");
  const approved: ArtworkApproval[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object")
      throw new CityRulesError("approved-artwork entries must be objects");
    const entry = item as Record<string, unknown>;
    if (typeof entry.repo !== "string" || typeof entry.sha256 !== "string")
      throw new CityRulesError("approved-artwork entries need repo and sha256");
    repoName(entry.repo);
    if (!/^[0-9a-f]{64}$/.test(entry.sha256))
      throw new CityRulesError("approved-artwork sha256 must be 64 hex chars");
    approved.push({ repo: entry.repo, sha256: entry.sha256 });
  }
  return { version: 1, approved };
}

export async function loadArtworkApprovals(
  root = ".city",
): Promise<ArtworkApprovals> {
  try {
    return parseArtworkApprovals(
      JSON.parse(await readFile(join(root, "approved-artwork.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, approved: [] };
    throw error;
  }
}

export function isApproved(
  approvals: ArtworkApprovals,
  fullName: string,
  sha256: string,
): boolean {
  const repo = fullName.toLowerCase();
  return approvals.approved.some(
    (a) => a.repo.toLowerCase() === repo && a.sha256 === sha256,
  );
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Read the PNG IHDR dimensions; throws for anything that is not a PNG. */
export function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.toString("latin1", 12, 16) !== "IHDR"
  )
    throw new CityRulesError("artwork is not a PNG file");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export interface ArtworkResolution {
  artwork?: ApprovedArtwork;
  warning?: string;
}

/**
 * Fetch the declared PNG from the repository's own default branch through the
 * trusted GitHub Contents API, verify bytes/size/dimensions/hash, and require
 * an operator approval before it is served. Anything else keeps the catalog
 * building and records why.
 */
export async function resolveArtwork(
  fullName: string,
  rule: ArtworkRule,
  approvals: ArtworkApprovals,
  cacheDir: string,
  token?: string,
  request: typeof fetch = fetch,
): Promise<ArtworkResolution> {
  repoName(fullName);
  if (!isApproved(approvals, fullName, rule.sha256))
    return {
      warning: `artwork ${rule.path} (${rule.sha256.slice(0, 12)}…) is not approved by the city; catalog building used`,
    };
  const cached = join(cacheDir, `${rule.sha256}.png`);
  let bytes: Buffer | undefined;
  try {
    bytes = await readFile(cached);
  } catch {
    bytes = undefined;
  }
  if (!bytes) {
    const response = await request(
      `https://api.github.com/repos/${fullName}/contents/${rule.path}`,
      {
        headers: {
          Accept: "application/vnd.github.raw+json",
          "User-Agent": "axp-city",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status === 404)
      return { warning: `artwork ${rule.path} was not found in the repository` };
    if (!response.ok) throw new Error(`GitHub artwork HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > ARTWORK_MAX_BYTES)
      return { warning: `artwork ${rule.path} exceeds ${ARTWORK_MAX_BYTES} bytes` };
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > ARTWORK_MAX_BYTES)
      return { warning: `artwork ${rule.path} exceeds ${ARTWORK_MAX_BYTES} bytes` };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== rule.sha256)
    return {
      warning: `artwork ${rule.path} bytes do not match the declared sha256; catalog building used`,
    };
  let size: { width: number; height: number };
  try {
    size = pngDimensions(bytes);
  } catch (error) {
    return { warning: (error as Error).message };
  }
  if (size.width !== rule.width || size.height !== rule.height)
    return {
      warning: `artwork ${rule.path} is ${size.width}×${size.height}, not the declared ${rule.width}×${rule.height}`,
    };
  await mkdir(cacheDir, { recursive: true });
  const temp = `${cached}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, cached);
  return {
    artwork: {
      sha256,
      width: size.width,
      height: size.height,
      url: `${ARTWORK_URL_PREFIX}${sha256}.png`,
    },
  };
}
