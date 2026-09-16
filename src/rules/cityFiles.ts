import type { BuildingBand, YardKind } from "../types.js";

export class CityRulesError extends Error {}

/** Props whose presence the parser derives from metrics. */
export type YardPropName =
  | "blueprint"
  | "drafting-table"
  | "materials"
  | "crew"
  | "drone";
/** Decorative props a version-2 rules file may add to a yard state. */
export type DecorPropName =
  | "cones"
  | "lamp"
  | "bench"
  | "tree"
  | "bush"
  | "planter";
export type AnyPropName = YardPropName | DecorPropName;

export const YARD_PROP_NAMES: readonly YardPropName[] = [
  "blueprint",
  "drafting-table",
  "materials",
  "crew",
  "drone",
];
export const DECOR_PROP_NAMES: readonly DecorPropName[] = [
  "cones",
  "lamp",
  "bench",
  "tree",
  "bush",
  "planter",
];

/** Rules file versions this parser accepts. Unknown versions are rejected. */
export const RULES_VERSIONS = [1, 2] as const;
export type RulesVersion = (typeof RULES_VERSIONS)[number];

/**
 * Custom building artwork declared by a repository. The file must live in the
 * repository's own default branch and its bytes must be approved by the city
 * (see `.city/approved-artwork.json`) before it replaces a catalog building.
 */
export interface ArtworkRule {
  /** Path inside the repository, e.g. `.city/building.png`. */
  path: string;
  /** Lowercase hex SHA-256 of the PNG bytes. */
  sha256: string;
  width: number;
  height: number;
}

/** Artwork that passed approval and is served by the city itself. */
export interface ApprovedArtwork {
  sha256: string;
  width: number;
  height: number;
  /** Same-origin URL the client loads, e.g. `/assets/artwork/<sha>.png`. */
  url: string;
}

export interface BuildingRules {
  version: RulesVersion;
  plot: "pad";
  sizeFrom: "stars";
  bands: Record<
    BuildingBand,
    { maxStarsExclusive?: number; ids: readonly [number, number] }
  >;
  quietWhen: "no-recent-activity";
  quietAlpha: number;
  buildingId?: number;
  /** Version 2 only. */
  artwork?: ArtworkRule;
}

/** Yard-local placement space, in world units from the yard origin. */
export const YARD_W = 1.8;
export const YARD_D = 2.2;
/** Minimum spacing between explicitly placed props. */
export const YARD_MIN_SPACING = 0.35;
export const YARD_MAX_SLOTS = 8;
export const MAX_BAYS = 3;

export interface YardSlot {
  prop: AnyPropName;
  x: number;
  y: number;
}

export interface YardLayout {
  /** Number of material bays (pallet stacks) a PR yard shows. */
  bays: 1 | 2 | 3;
  /** Explicit prop placements; validated against the yard bounds and spacing. */
  slots: YardSlot[];
}

export interface LoadingZoneRules {
  version: RulesVersion;
  plot: "receiving-yard";
  precedence: readonly ["openPrs", "openIssues", "recentActivity"];
  props: Record<
    "issues" | "prs" | "recent" | "highPrsOrBot",
    readonly AnyPropName[]
  >;
  combinedBlueprint: boolean;
  /** Version 2 only. */
  layout?: YardLayout;
}

export interface CityRules {
  building: BuildingRules;
  loadingZone: LoadingZoneRules;
}

/**
 * The single source of truth for default bands, catalog ranges, and props.
 * `.city/building.json` and `.city/loading-zone.json` in this checkout must
 * stay identical to these values (enforced by a unit test).
 */
export const DEFAULT_RULES: CityRules = {
  building: {
    version: 1,
    plot: "pad",
    sizeFrom: "stars",
    bands: {
      S: { maxStarsExclusive: 5000, ids: [1, 17] },
      M: { maxStarsExclusive: 20000, ids: [18, 34] },
      L: { ids: [35, 50] },
    },
    quietWhen: "no-recent-activity",
    quietAlpha: 0.62,
  },
  loadingZone: {
    version: 1,
    plot: "receiving-yard",
    precedence: ["openPrs", "openIssues", "recentActivity"],
    props: {
      issues: ["blueprint", "drafting-table"],
      prs: ["materials"],
      recent: ["crew"],
      highPrsOrBot: ["drone"],
    },
    combinedBlueprint: true,
  },
};

function object(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new CityRulesError(`${label} must be an object`);
  return raw as Record<string, unknown>;
}

function keys(
  raw: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  for (const key of Object.keys(raw))
    if (!allowed.includes(key))
      throw new CityRulesError(`Unknown ${label}.${key}`);
}

function version(raw: Record<string, unknown>, label: string): RulesVersion {
  const v = raw.version ?? 1;
  if (!RULES_VERSIONS.includes(v as RulesVersion))
    throw new CityRulesError(
      `${label} version ${String(v)} is not supported (accepted: ${RULES_VERSIONS.join(", ")})`,
    );
  return v as RulesVersion;
}

export function parseArtworkRule(raw: unknown): ArtworkRule {
  const input = object(raw, "artwork");
  keys(input, ["path", "sha256", "width", "height"], "artwork");
  const path = input.path;
  if (
    typeof path !== "string" ||
    !/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.png$/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..") ||
    path.length > 200
  )
    throw new CityRulesError(
      "artwork.path must be a relative .png path inside the repository",
    );
  const sha256 = input.sha256;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))
    throw new CityRulesError("artwork.sha256 must be 64 lowercase hex chars");
  const width = input.width;
  const height = input.height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) < 32 ||
    (height as number) < 32 ||
    (width as number) > 512 ||
    (height as number) > 512
  )
    throw new CityRulesError("artwork width/height must be integers 32–512");
  return {
    path,
    sha256,
    width: width as number,
    height: height as number,
  };
}

export function parseBuildingRules(
  raw: unknown,
  base = DEFAULT_RULES.building,
): BuildingRules {
  const input = object(raw, "building");
  const v = version(input, "building");
  keys(
    input,
    [
      "version",
      "plot",
      "sizeFrom",
      "bands",
      "quietWhen",
      "quietAlpha",
      "buildingId",
      ...(v >= 2 ? ["artwork"] : []),
    ],
    "building",
  );
  const r = { ...base, ...input, version: v } as BuildingRules;
  if (
    r.plot !== "pad" ||
    r.sizeFrom !== "stars" ||
    r.quietWhen !== "no-recent-activity"
  )
    throw new CityRulesError("building plot/sizeFrom/quietWhen is invalid");
  if (!Number.isFinite(r.quietAlpha) || r.quietAlpha <= 0 || r.quietAlpha > 1)
    throw new CityRulesError("quietAlpha must be in (0,1]");
  if (
    r.buildingId !== undefined &&
    (!Number.isInteger(r.buildingId) || r.buildingId < 1 || r.buildingId > 50)
  )
    throw new CityRulesError("buildingId must be in 1–50");
  const bands = object(input.bands ?? {}, "bands");
  keys(bands, ["S", "M", "L"], "bands");
  r.bands = { ...base.bands };
  for (const band of ["S", "M", "L"] as const) {
    const patch = object(bands[band] ?? {}, band);
    keys(patch, ["ids", "maxStarsExclusive"], band);
    const b = { ...base.bands[band], ...patch } as BuildingRules["bands"]["S"];
    if (
      !Array.isArray(b.ids) ||
      b.ids.length !== 2 ||
      b.ids.some((n) => !Number.isInteger(n) || n < 1 || n > 50) ||
      b.ids[0] > b.ids[1]
    )
      throw new CityRulesError(
        `${band}.ids must be an inclusive range in 1–50`,
      );
    if (
      band !== "L" &&
      (!Number.isFinite(b.maxStarsExclusive) || b.maxStarsExclusive! <= 0)
    )
      throw new CityRulesError(`${band}.maxStarsExclusive must be positive`);
    r.bands[band] = b;
  }
  if (r.bands.S.maxStarsExclusive! >= r.bands.M.maxStarsExclusive!)
    throw new CityRulesError("Star thresholds must increase");
  if (input.artwork !== undefined) r.artwork = parseArtworkRule(input.artwork);
  else delete r.artwork;
  return r;
}

export function parseYardLayout(raw: unknown): YardLayout {
  const input = object(raw, "layout");
  keys(input, ["bays", "slots"], "layout");
  const bays = input.bays ?? 1;
  if (!Number.isInteger(bays) || (bays as number) < 1 || (bays as number) > MAX_BAYS)
    throw new CityRulesError(`layout.bays must be 1–${MAX_BAYS}`);
  const slotsRaw = input.slots ?? [];
  if (!Array.isArray(slotsRaw) || slotsRaw.length > YARD_MAX_SLOTS)
    throw new CityRulesError(
      `layout.slots must be an array of at most ${YARD_MAX_SLOTS} placements`,
    );
  const slots: YardSlot[] = [];
  const names: string[] = [...YARD_PROP_NAMES, ...DECOR_PROP_NAMES];
  for (const [i, item] of slotsRaw.entries()) {
    const slot = object(item, `layout.slots[${i}]`);
    keys(slot, ["prop", "x", "y"], `layout.slots[${i}]`);
    if (typeof slot.prop !== "string" || !names.includes(slot.prop))
      throw new CityRulesError(`layout.slots[${i}].prop is not a known prop`);
    const x = slot.x;
    const y = slot.y;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x > YARD_W ||
      y > YARD_D
    )
      throw new CityRulesError(
        `layout.slots[${i}] must lie inside the yard (0–${YARD_W} × 0–${YARD_D})`,
      );
    for (const other of slots)
      if (Math.hypot(other.x - x, other.y - y) < YARD_MIN_SPACING)
        throw new CityRulesError(
          `layout.slots[${i}] is closer than ${YARD_MIN_SPACING} to another placement`,
        );
    slots.push({ prop: slot.prop as AnyPropName, x, y });
  }
  return { bays: bays as 1 | 2 | 3, slots };
}

export function parseLoadingZoneRules(
  raw: unknown,
  base = DEFAULT_RULES.loadingZone,
): LoadingZoneRules {
  const input = object(raw, "loading-zone");
  const v = version(input, "loading-zone");
  keys(
    input,
    [
      "version",
      "plot",
      "precedence",
      "props",
      "combinedBlueprint",
      ...(v >= 2 ? ["layout"] : []),
    ],
    "loading-zone",
  );
  const r = { ...base, ...input, version: v } as LoadingZoneRules;
  if (r.plot !== "receiving-yard")
    throw new CityRulesError("loading-zone plot must be receiving-yard");
  if (
    JSON.stringify(r.precedence) !==
    JSON.stringify(DEFAULT_RULES.loadingZone.precedence)
  )
    throw new CityRulesError(
      "precedence must be openPrs, openIssues, recentActivity",
    );
  if (typeof r.combinedBlueprint !== "boolean")
    throw new CityRulesError("combinedBlueprint must be boolean");
  const props = object(input.props ?? {}, "props");
  keys(props, ["issues", "prs", "recent", "highPrsOrBot"], "props");
  r.props = { ...base.props, ...props };
  const names: string[] = [
    ...YARD_PROP_NAMES,
    ...(v >= 2 ? DECOR_PROP_NAMES : []),
  ];
  for (const value of Object.values(r.props))
    if (!Array.isArray(value) || value.some((p) => !names.includes(p)))
      throw new CityRulesError(
        v >= 2
          ? "Invalid loading-zone prop"
          : "Invalid loading-zone prop (decor props require version 2)",
      );
  if (input.layout !== undefined) r.layout = parseYardLayout(input.layout);
  else delete r.layout;
  return r;
}

export function yardPropList(flags: {
  showBlueprint: boolean;
  showDraftingTable: boolean;
  showMaterials: boolean;
  showCrew: boolean;
  showDrone: boolean;
  extraProps?: readonly DecorPropName[];
}): AnyPropName[] {
  const pairs = [
    ["showBlueprint", "blueprint"],
    ["showDraftingTable", "drafting-table"],
    ["showMaterials", "materials"],
    ["showCrew", "crew"],
    ["showDrone", "drone"],
  ] as const;
  return [
    ...pairs.filter(([key]) => flags[key]).map(([, value]) => value),
    ...(flags.extraProps ?? []),
  ];
}

export function yardLabel(yard: YardKind): string {
  return yard.replaceAll("_", " ");
}
