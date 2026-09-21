import { describe, expect, it } from "vitest";
import {
  advanceWorld,
  BUILDINGS,
  cellAt,
  deserializeWorld,
  serializeWorld,
} from "../src/core/index.js";
import { connectedRoads } from "../src/core/grid.js";
import {
  buildAtlas,
  catalog,
  createRegionWorld,
  validateCatalog,
  type GeoJsonPolygon,
  type Repo,
} from "../game/src/atlas/catalog.js";

const area = (geometry: GeoJsonPolygon) => {
  const points = geometry.coordinates[0];
  return (
    points
      .slice(0, -1)
      .reduce(
        (sum, a, i) => sum + a[0] * points[i + 1][1] - points[i + 1][0] * a[1],
        0,
      ) / 2
  );
};
const inPolygon = (geometry: GeoJsonPolygon, point: number[]) => {
  const points = geometry.coordinates[0];
  let inside = false;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const cross =
      (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (
      Math.abs(cross) < 1e-8 &&
      point[0] >= Math.min(a[0], b[0]) - 1e-8 &&
      point[0] <= Math.max(a[0], b[0]) + 1e-8 &&
      point[1] >= Math.min(a[1], b[1]) - 1e-8 &&
      point[1] <= Math.max(a[1], b[1]) + 1e-8
    )
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
};
const bounds = (geometry: GeoJsonPolygon) => {
  const points = geometry.coordinates[0];
  return [
    Math.min(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[1])),
  ];
};

describe("repository atlas", () => {
  it("preserves measured public languages, including unexpected languages of named projects", () => {
    expect(catalog.label).toBe("Public repository sample");
    expect(catalog.repos).toHaveLength(40);
    expect(buildAtlas(catalog).continents).toHaveLength(9);
    expect(
      catalog.repos.find((repo) => repo.fullName === "shuding/cobe")?.language,
    ).toBe("TypeScript");
    expect(
      catalog.repos.find((repo) => repo.fullName === "vasturiano/globe.gl")
        ?.language,
    ).toBe("HTML");
    expect(
      catalog.repos.find((repo) => repo.fullName === "microsoft/TypeScript")
        ?.language,
    ).toBe("Go");
    expect(catalog.repos.every((repo) => /^github:\d+$/.test(repo.id))).toBe(
      true,
    );
  });

  it("groups independently of input order without losing, duplicating or inventing repositories or tags", () => {
    const atlas = buildAtlas(catalog);
    const reordered = {
      ...catalog,
      repos: [...catalog.repos].reverse().map((repo) => ({
        ...repo,
        topics: repo.topics && [...repo.topics].reverse(),
      })),
    };
    expect(buildAtlas(reordered)).toEqual(atlas);
    expect(
      atlas.regions
        .flatMap((region) => region.repos.map((repo) => repo.id))
        .sort(),
    ).toEqual(catalog.repos.map((repo) => repo.id).sort());
    for (const continent of atlas.continents) {
      expect(continent.regions.length).toBeGreaterThan(0);
      expect(continent.regions.length).toBeLessThanOrEqual(4);
      expect(continent.regions.flatMap((region) => region.repos)).toHaveLength(
        continent.repoCount,
      );
      for (const region of continent.regions) {
        expect(
          region.repos.every((repo) => repo.language === continent.language),
        ).toBe(true);
        if (region.topic)
          expect(
            region.repos.every((repo) => repo.topics?.includes(region.topic!)),
          ).toBe(true);
        for (const topic of region.topics)
          expect(
            region.repos.some((repo) => repo.topics?.includes(topic)),
          ).toBe(true);
      }
    }
  });

  it("makes closed, nonoverlapping continent shapes partitioned by contained region polygons", () => {
    const atlas = buildAtlas(catalog);
    for (const continent of atlas.continents) {
      expect(continent.geometry.coordinates[0]).toHaveLength(97);
      const geometries = [
        continent.geometry,
        ...continent.regions.map((region) => region.geometry),
      ];
      for (const geometry of geometries) {
        const points = geometry.coordinates[0];
        expect(points[0]).toEqual(points.at(-1));
        expect(area(geometry)).toBeGreaterThan(0);
        for (const [lng, lat] of points) {
          expect(Number.isFinite(lat) && Number.isFinite(lng)).toBe(true);
          expect(Math.abs(lat)).toBeLessThan(90);
          expect(Math.abs(lng)).toBeLessThan(180);
          expect(inPolygon(continent.geometry, [lng, lat])).toBe(true);
        }
        for (let index = 0; index < points.length - 1; index++) {
          const a = points[index],
            b = points[index + 1];
          for (const fraction of [0.25, 0.5, 0.75])
            expect(
              inPolygon(continent.geometry, [
                a[0] + (b[0] - a[0]) * fraction,
                a[1] + (b[1] - a[1]) * fraction,
              ]),
            ).toBe(true);
        }
      }
      expect(
        continent.regions.reduce(
          (sum, region) => sum + area(region.geometry),
          0,
        ),
      ).toBeCloseTo(area(continent.geometry), 8);
      for (const region of continent.regions)
        expect(inPolygon(region.geometry, [region.lng, region.lat])).toBe(true);
    }
    atlas.continents.forEach((continent, index) => {
      const a = bounds(continent.geometry);
      for (const other of atlas.continents.slice(index + 1)) {
        const b = bounds(other.geometry);
        expect(a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]).toBe(
          true,
        );
      }
    });
  });

  it("retains missing metadata as unavailable instead of guessing a topic from a name", () => {
    const repos = catalog.repos
      .slice(0, 2)
      .map((repo, i) => ({ ...repo, language: null, topics: i ? [] : null }));
    const atlas = buildAtlas({ ...catalog, repos });
    expect(atlas.continents[0].name).toBe("Unclassified");
    expect(atlas.regions[0].name).toBe("Topic unavailable");
    expect(atlas.regions[0].topics).toEqual([]);
    expect(atlas.regions[0].repos[0].topics).not.toEqual(
      atlas.regions[0].repos[1].topics,
    );
  });

  it("rejects malformed catalog records and duplicate stable identities", () => {
    const repo = catalog.repos[0];
    for (const repos of [
      [repo, repo],
      [{ ...repo, url: "javascript:alert(1)" }],
      [{ ...repo, topics: [12] }],
    ])
      expect(() => validateCatalog({ ...catalog, repos })).toThrow(
        "Invalid repository catalog",
      );
    expect(() => validateCatalog({ ...catalog, version: 2 })).toThrow();
    expect(() =>
      validateCatalog({ ...catalog, capturedAt: "not-a-date" }),
    ).toThrow();
  });
});

describe("region city generation", () => {
  it("places exactly one legal building per repository and survives simulation/save loading", () => {
    for (const region of buildAtlas(catalog).regions) {
      const { world, repoByBuildingId } = createRegionWorld(region);
      expect(world.buildings).toHaveLength(region.repos.length);
      expect(
        Object.values(repoByBuildingId)
          .map((repo) => repo.id)
          .sort(),
      ).toEqual(region.repos.map((repo) => repo.id).sort());
      expect(connectedRoads(world)).toBe(true);
      for (const building of world.buildings) {
        const definition = BUILDINGS[building.kind];
        expect(
          Number.isInteger(building.x) && Number.isInteger(building.y),
        ).toBe(true);
        expect(
          cellAt(
            world,
            building.x + definition.access.x,
            building.y + definition.access.y,
          )?.road,
        ).toBe(true);
      }
      const stored = serializeWorld(world);
      expect(deserializeWorld(stored)).toEqual(world);
      advanceWorld(world, 20_000);
      expect(deserializeWorld(serializeWorld(world))).toEqual(world);
      expect(createRegionWorld(region).world).toEqual(deserializeWorld(stored));
    }
  });

  it("fills the bounded city to capacity without dropping repos or crossing terrain/footprints", () => {
    const base = buildAtlas(catalog).regions[0];
    const repos: Repo[] = Array.from({ length: 63 }, (_, i) => ({
      ...base.repos[0],
      id: `capacity:${i}`,
      fullName: `sample/repo${i}`,
      url: `https://github.com/sample/repo${i}`,
    }));
    const region = { ...base, repos },
      { world, repoByBuildingId } = createRegionWorld(region);
    expect(world.buildings).toHaveLength(63);
    expect(Object.keys(repoByBuildingId)).toHaveLength(63);
    expect(deserializeWorld(serializeWorld(world))).toEqual(world);
    expect(
      createRegionWorld({ ...region, repos: [...repos].reverse() }),
    ).toEqual({ world, repoByBuildingId });
    expect(() =>
      createRegionWorld({
        ...region,
        repos: [...repos, { ...repos[0], id: "overflow" }],
      }),
    ).toThrow("between 1 and 63");
    expect(() => createRegionWorld({ ...region, repos: [] })).toThrow(
      "between 1 and 63",
    );
  });
});
