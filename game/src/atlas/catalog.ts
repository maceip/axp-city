import rawCatalog from "./public-repositories.json" with { type: "json" };
import {
  applyCommand,
  BUILDINGS,
  createWorld,
  type BuildingKind,
  type WorldState,
} from "../../../src/core/index.js";

export interface Repo {
  id: string;
  fullName: string;
  url: string;
  language: string | null;
  /** null means unmeasured; [] means GitHub supplied no topics. */
  topics: string[] | null;
}
export interface RepositoryCatalog {
  version: 1;
  label: string;
  capturedAt: string;
  source: string;
  repos: Repo[];
}
export interface GeoJsonPolygon {
  type: "Polygon";
  /** GeoJSON longitude, latitude pairs; each ring is explicitly closed. */
  coordinates: Array<Array<[number, number]>>;
}
export interface AtlasRegion {
  id: string;
  continentId: string;
  name: string;
  topic: string | null;
  /** Actual canonical topics represented here, including mixed fallback regions. */
  topics: string[];
  color: string;
  lat: number;
  lng: number;
  geometry: GeoJsonPolygon;
  repos: Repo[];
}
export interface AtlasContinent {
  id: string;
  name: string;
  language: string | null;
  color: string;
  lat: number;
  lng: number;
  geometry: GeoJsonPolygon;
  regions: AtlasRegion[];
  repoCount: number;
}
export interface Atlas {
  catalog: RepositoryCatalog;
  continents: AtlasContinent[];
  regions: AtlasRegion[];
  repoCount: number;
}

function hash(value: string): number {
  let result = 2166136261;
  for (const char of value)
    result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const repoOrder = (a: Repo, b: Repo) => compare(a.id, b.id);
const key = (value: string) => encodeURIComponent(value.toLowerCase());

/** Validate a static metadata document without credentials, requests or old saves. */
export function validateCatalog(value: unknown): RepositoryCatalog {
  const fail = (): never => {
    throw new Error("Invalid repository catalog.");
  };
  if (!value || typeof value !== "object") return fail();
  const input = value as RepositoryCatalog;
  if (
    input.version !== 1 ||
    typeof input.label !== "string" ||
    !input.label.trim() ||
    typeof input.source !== "string" ||
    !input.source.trim() ||
    typeof input.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(input.capturedAt)) ||
    !Array.isArray(input.repos) ||
    input.repos.length > 10000
  )
    return fail();
  const ids = new Set<string>(),
    names = new Set<string>();
  const repos = input.repos.map((repo): Repo => {
    if (
      !repo ||
      typeof repo !== "object" ||
      typeof repo.id !== "string" ||
      !repo.id ||
      typeof repo.fullName !== "string" ||
      !/^[\w.-]+\/[\w.-]+$/.test(repo.fullName) ||
      repo.url !== `https://github.com/${repo.fullName}` ||
      !(
        repo.language === null ||
        (typeof repo.language === "string" && repo.language.trim())
      ) ||
      !(
        repo.topics === null ||
        (Array.isArray(repo.topics) &&
          repo.topics.every(
            (t) => typeof t === "string" && /^[a-z0-9][a-z0-9-]*$/.test(t),
          ))
      )
    )
      return fail();
    if (ids.has(repo.id) || names.has(repo.fullName.toLowerCase()))
      return fail();
    ids.add(repo.id);
    names.add(repo.fullName.toLowerCase());
    return {
      id: repo.id,
      fullName: repo.fullName,
      url: repo.url,
      language: repo.language,
      topics:
        repo.topics === null ? null : [...new Set(repo.topics)].sort(compare),
    };
  });
  return {
    version: 1,
    label: input.label,
    source: input.source,
    capturedAt: input.capturedAt,
    repos: repos.sort(repoOrder),
  };
}

export const catalog: RepositoryCatalog = validateCatalog(rawCatalog);

// These are invented language continents, not claims about Earth's geography.
// Fixed anchors keep a language in the same place across catalog ordering changes.
type Site = [
  lat: number,
  lng: number,
  width: number,
  height: number,
  color: string,
];
const SITES: Record<string, Site> = {
  JavaScript: [20, -20, 29, 21, "#ddbe63"],
  Python: [-26, 30, 30, 21, "#73a9bb"],
  TypeScript: [39, 52, 25, 18, "#83abd4"],
  Go: [-31, -61, 27, 19, "#76bbb3"],
  Rust: [37, -102, 25, 20, "#c58d71"],
  Kotlin: [-9, 130, 24, 20, "#b49cce"],
  Java: [39, 139, 24, 18, "#d3a278"],
  "C++": [-46, -139, 25, 18, "#8fa8c7"],
  HTML: [2, -150, 13, 9, "#d48d75"],
};
const EXTRA_SITES: Site[] = [
  [72, -60, 16, 7, "#a0ad8a"],
  [72, 60, 16, 7, "#9daca8"],
  [-75, 0, 16, 7, "#c0ac87"],
];
const TOPIC_PRIORITY = [
  "webgl",
  "webgpu",
  "globe",
  "web",
  "web-framework",
  "frontend",
  "ui",
  "react",
  "llm",
  "machine-learning",
  "deep-learning",
  "computer-vision",
  "ggml",
  "database",
  "storage-engine",
  "search-engine",
  "streaming",
  "time-series",
  "containers",
  "distributed-systems",
  "monitoring",
  "cli",
  "terminal",
  "shell-prompt",
  "editor",
  "linter",
  "typechecker",
  "compiler",
  "programming-language",
  "language",
  "android",
  "desktop-app",
  "mobile-app",
  "music",
  "http",
  "static-site-generator",
  "framework",
];
const GENERIC_TOPICS = new Set([
  "javascript",
  "typescript",
  "python",
  "python3",
  "go",
  "golang",
  "rust",
  "kotlin",
  "java",
  "c-plus-plus",
  "html",
  "hacktoberfest",
  "good-first-issue",
  "contributions-welcome",
  "mit",
  "windows",
  "linux",
  "macos",
]);
function canonicalTopic(repo: Repo): string | null {
  if (!repo.topics?.length) return null;
  return (
    TOPIC_PRIORITY.find((topic) => repo.topics!.includes(topic)) ??
    repo.topics.find((topic) => !GENERIC_TOPICS.has(topic)) ??
    repo.topics[0]
  );
}
const topicRank = (topic: string | null) => {
  const index = TOPIC_PRIORITY.indexOf(topic ?? "");
  return index < 0 ? TOPIC_PRIORITY.length : index;
};
const TOPIC_LABELS: Record<string, string> = {
  ai: "AI",
  llm: "LLM",
  cli: "CLI",
  ui: "UI",
  http: "HTTP",
  webgl: "WebGL",
  webgpu: "WebGPU",
};
const topicName = (topic: string) =>
  topic
    .split("-")
    .map(
      (word) =>
        TOPIC_LABELS[word] ?? word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");

type Vertex = [number, number];
function polygon(points: Vertex[]): GeoJsonPolygon {
  return {
    type: "Polygon",
    coordinates: [[...points, [...points[0]] as Vertex]],
  };
}
function shape(site: Site, seed: number): GeoJsonPolygon {
  const [lat, lng, width, height] = site,
    phase = (seed / 0xffffffff) * Math.PI * 2;
  const coast: Vertex[] = Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    const radius =
      1 +
      0.2 * Math.sin(3 * angle + phase) +
      0.065 * Math.cos(2 * angle + phase * 0.4) +
      0.025 * Math.sin(7 * angle + phase) +
      0.01 * Math.cos(11 * angle + phase);
    const x = Math.cos(angle);
    // Both shores remain monotonic in longitude, keeping each clipped region
    // contiguous even when the coastline has coves and asymmetric peninsulas.
    return [
      x * (1 + 0.08 * x),
      Math.sin(angle) * radius + 0.12 * x * Math.sin(phase),
    ];
  });
  const scaleX = Math.max(...coast.map((p) => Math.abs(p[0])));
  const scaleY = Math.max(...coast.map((p) => Math.abs(p[1])));
  return polygon(
    coast.map(([x, y]) => [
      lng + (x / scaleX) * width * 0.98,
      lat + (y / scaleY) * height * 0.98,
    ]),
  );
}
function clip(
  points: Vertex[],
  boundary: number,
  keepRight: boolean,
): Vertex[] {
  const result: Vertex[] = [],
    inside = (p: Vertex) => (keepRight ? p[0] >= boundary : p[0] <= boundary);
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (inside(a)) result.push(a);
    if (inside(a) !== inside(b)) {
      const fraction = (boundary - a[0]) / (b[0] - a[0]);
      result.push([boundary, a[1] + fraction * (b[1] - a[1])]);
    }
  }
  return result;
}
function center(geometry: GeoJsonPolygon): { lat: number; lng: number } {
  const points = geometry.coordinates[0].slice(0, -1);
  return {
    lng: points.reduce((sum, p) => sum + p[0], 0) / points.length,
    lat: points.reduce((sum, p) => sum + p[1], 0) / points.length,
  };
}
interface Group {
  topic: string | null;
  topics: string[];
  repos: Repo[];
  other?: boolean;
}

/** Deterministic, non-overlapping atlas; every repository belongs to exactly one region. */
export function buildAtlas(input: RepositoryCatalog): Atlas {
  const catalog = validateCatalog(input),
    byLanguage = new Map<string | null, Repo[]>();
  for (const repo of [...catalog.repos].sort(repoOrder)) {
    const list = byLanguage.get(repo.language) ?? [];
    list.push(repo);
    byLanguage.set(repo.language, list);
  }
  const languages = [...byLanguage.keys()].sort((a, b) =>
    compare(a ?? "", b ?? ""),
  );
  const extras = languages.filter((language) => !SITES[language ?? ""]);
  if (extras.length > EXTRA_SITES.length)
    throw new Error(
      "This atlas supports at most three additional language islands.",
    );
  const continents = languages.map((language): AtlasContinent => {
    const name = language ?? "Unclassified",
      id = `language:${key(name)}`,
      repos = byLanguage.get(language)!;
    const site = SITES[name] ?? EXTRA_SITES[extras.indexOf(language)],
      geometry = shape(site, hash(id));
    const grouped = new Map<string | null, Repo[]>();
    for (const repo of repos) {
      const topic = canonicalTopic(repo),
        list = grouped.get(topic) ?? [];
      list.push(repo);
      grouped.set(topic, list);
    }
    const groups: Group[] = [...grouped]
      .map(([topic, repos]) => ({ topic, topics: topic ? [topic] : [], repos }))
      .sort(
        (a, b) =>
          b.repos.length - a.repos.length ||
          topicRank(a.topic) - topicRank(b.topic) ||
          compare(a.topic ?? "", b.topic ?? ""),
      );
    if (groups.length > 4) {
      const rest = groups.splice(3);
      groups.push({
        topic: null,
        topics: rest.flatMap((group) => group.topics).sort(compare),
        repos: rest.flatMap((group) => group.repos).sort(repoOrder),
        other: true,
      });
    }
    const points = geometry.coordinates[0].slice(0, -1),
      left = Math.min(...points.map((p) => p[0])),
      right = Math.max(...points.map((p) => p[0]));
    let offset = 0;
    const regions = groups.map((group): AtlasRegion => {
      const start = left + ((right - left) * offset) / repos.length;
      offset += group.repos.length;
      const end = left + ((right - left) * offset) / repos.length;
      const regionGeometry = polygon(
        clip(clip(points, start, true), end, false),
      );
      const tag = group.other
        ? "other-topics"
        : (group.topic ?? "topic-unavailable");
      return {
        id: `${id}/topic:${key(tag)}`,
        continentId: id,
        name: group.other
          ? "Other topics"
          : group.topic
            ? topicName(group.topic)
            : "Topic unavailable",
        topic: group.topic,
        topics: group.topics,
        color: site[4],
        ...center(regionGeometry),
        geometry: regionGeometry,
        repos: [...group.repos].sort(repoOrder),
      };
    });
    return {
      id,
      name,
      language,
      color: site[4],
      lat: site[0],
      lng: site[1],
      geometry,
      regions,
      repoCount: repos.length,
    };
  });
  return {
    catalog,
    continents,
    regions: continents.flatMap((continent) => continent.regions),
    repoCount: catalog.repos.length,
  };
}

/** Build a separate city from metadata; never read or migrate a user's saved town. */
export function createRegionWorld(region: AtlasRegion): {
  world: WorldState;
  repoByBuildingId: Record<string, Repo>;
} {
  const repos = [...region.repos].sort(repoOrder);
  if (!repos.length || repos.length > 63)
    throw new Error(
      "A region city must contain between 1 and 63 repositories.",
    );
  if (new Set(repos.map((repo) => repo.id)).size !== repos.length)
    throw new Error("Duplicate repository in region city.");
  const world = createWorld(hash(region.id));
  for (const cell of world.cells) {
    cell.road = false;
    cell.occupant = null;
  }
  world.buildings = [];
  world.vehicles = [];
  world.nextId = 1;
  const columns = Math.min(
    7,
    Math.max(2, Math.ceil(Math.sqrt(repos.length * 1.6))),
  );
  const rows = Math.ceil(repos.length / columns),
    firstX = Math.max(-9, 1 - Math.floor((columns * 5) / 2));
  const firstRoad = -Math.floor((rows - 1) * 3),
    top = firstRoad - 4,
    bottom = firstRoad + (rows - 1) * 6;
  const left = firstX - 2,
    right = firstX + (columns - 1) * 5 + 4;
  const road = (x: number, y: number) => {
    const result = applyCommand(world, { type: "road", x, y });
    if (!result.ok)
      throw new Error(`Cannot build region street: ${result.message}`);
  };
  for (let y = top; y <= bottom; y++) road(left, y);
  for (const y of [
    top,
    ...Array.from({ length: rows }, (_, row) => firstRoad + row * 6),
  ])
    for (let x = left; x <= right; x++) road(x, y);
  for (let y = top; y <= bottom; y++) road(right, y);
  const slots = Array.from({ length: rows * columns }, (_, index) => ({
    x: firstX + (index % columns) * 5,
    roadY: firstRoad + Math.floor(index / columns) * 6,
  })).sort(
    (a, b) =>
      Math.hypot(a.x + 1, a.roadY - 1) - Math.hypot(b.x + 1, b.roadY - 1) ||
      a.roadY - b.roadY ||
      a.x - b.x,
  );
  const kinds: BuildingKind[] = ["cottage", "shop", "workshop"],
    repoByBuildingId: Record<string, Repo> = {};
  repos.forEach((repo, index) => {
    const slot = slots[index],
      kind = kinds[hash(repo.id) % kinds.length],
      y = slot.roadY - BUILDINGS[kind].depth;
    const result = applyCommand(world, {
      type: "building",
      kind,
      x: slot.x,
      y,
    });
    if (!result.ok)
      throw new Error(
        `Cannot place repository ${repo.fullName}: ${result.message}`,
      );
    repoByBuildingId[world.buildings.at(-1)!.id] = repo;
  });
  const starts = [
    { x: left, y: top },
    { x: right, y: bottom },
    { x: right, y: top },
  ];
  for (const point of starts.slice(0, Math.min(3, Math.ceil(repos.length / 3))))
    world.vehicles.push({
      ...point,
      id: `vehicle-${world.nextId++}`,
      heading: "e",
      to: null,
      progress: 0,
      route: [],
      goal: null,
      trips: 0,
    });
  world.revision = 0;
  return { world, repoByBuildingId };
}
