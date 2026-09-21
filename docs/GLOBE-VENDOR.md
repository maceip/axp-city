# Globe runtime provenance

AXP City vendors the prebuilt ESM runtime of
[Globe.gl](https://github.com/vasturiano/globe.gl), version **2.46.2**, the npm
`latest` stable release checked on 2026-09-20. The published package records
upstream commit **6820a9c794bddde8e842bb203eaa698f6ed7adfe**, which also matched
the repository's HEAD when checked.

## Why this project

The requested globe has selectable language continents, whole-continent hover,
theme regions, language icons, and animated navigation toward cities. Globe.gl
already exposes `Polygon`/`MultiPolygon` geometry, polygon hover/click callbacks,
HTML marker elements, animated `pointOfView`, and Three.js OrbitControls.
These are direct integration points for those requirements; the application's
semantic levels, identity mapping, and Phaser transition still need their own
implementation. See the upstream [polygon and render-control API](https://github.com/vasturiano/globe.gl#api-reference).

[COBE](https://github.com/shuding/cobe) was also inspected at version 2.0.1,
commit `04b800b72abfcdc2253309e388477d17015afd71`. It is a substantially smaller
renderer with zero runtime dependencies. Its current typed API exposes markers,
arcs, rotation/scale parameters, `update`, and `destroy`; it has no polygon layer,
continent hit testing, orbit controls, or camera tween API. Those would require
additional implementation for this task. Its current source loads an embedded
map texture, whereas Globe.gl accepts application-defined geographic polygons.

Downloaded published artifact sizes, measured without installing COBE:

| Artifact                                          | Raw bytes | Gzip bytes |
| ------------------------------------------------- | --------: | ---------: |
| COBE 2.0.1 `dist/index.esm.js`                    |    12,937 |      5,832 |
| Globe.gl 2.46.2 standalone `dist/globe.gl.min.js` | 1,885,160 |    523,108 |

These are different distribution forms, not application bundle or rendering
benchmarks. The standalone Globe.gl bundle is **not** vendored. A browser ESM
smoke bundle importing this vendored ESM entry and `MeshBasicMaterial` through
the installed dependency graph measured 1,966,060 bytes raw / 557,263 bytes gzip
with esbuild. The actual application build may differ. Load the globe at its
application boundary and measure the integrated result.

## Vendored files and integrity

The source is the official
[npm 2.46.2 metadata](https://registry.npmjs.org/globe.gl/2.46.2) and its
[published tarball](https://registry.npmjs.org/globe.gl/-/globe.gl-2.46.2.tgz).
The downloaded tarball was checked against **both** published SHA-512 integrity
and SHA-1 shasum before any file was written:

```text
sha512-oh5fx/sTVtFa06OrLXxgfZ5TV1xhDzLKw0muc0fxJfpHrvfDNRspGqrgURpEBBYWS7REzQA78vodUrjbpfYoqA==
sha1-d76bfdde11f966e5e2ec17ba38e885dc4227a98e
```

Only these runtime/reference files were copied from the package into
[`vendor/globe.gl`](../vendor/globe.gl/):

- `dist/globe.gl.mjs` — unchanged prebuilt ESM runtime, 23,090 bytes.
- `dist/globe.gl.d.ts` — unchanged public declarations, 9,273 bytes.
- `LICENSE` — unchanged MIT license, Copyright (c) 2019 Vasco Asturiano.
- `README.md` — unchanged upstream API documentation.
- `UPSTREAM-PACKAGE.json` — the unchanged upstream `package.json`.

[`UPSTREAM.json`](../vendor/globe.gl/UPSTREAM.json) records the registry URL,
tarball integrity, upstream commit, per-file SHA-256 hashes, and packaging
adaptation. The supplied examples, demo data, imagery, UMD bundles, and source
maps were not copied.

The local `package.json` preserves package identity, ESM/types entrypoints,
license, engine declaration, and original runtime dependency ranges. It removes
the unavailable UMD export and replaces the file list with this subset. Build
scripts and development dependencies are omitted: this package consumes the
published build, and upstream `prepare` would otherwise attempt to rebuild
source that is deliberately not vendored. The runtime and declarations were
not modified.

The application dependency is `"globe.gl": "file:vendor/globe.gl"`. Include the
vendor directory wherever `npm ci` is run. The existing `package-lock.json`
records the complete resolved dependency graph. The application explicitly pins
`three` to **0.186.0**, compatible with upstream `>=0.179 <1`, and pins development
declarations `@types/three` to **0.186.0**. The installed graph resolves one shared
Three.js version for the application, Globe.gl, `three-globe` 2.45.2, and
`three-render-objects` 1.42.0.

The Globe.gl MIT notice is retained in the vendor folder. Preserve it in
distributed builds alongside dependency notices. Geographic data and icon
licenses are separate from the runtime license; none are included by this
vendoring step.

## Integration API notes

```ts
import Globe, { type GlobeInstance } from "globe.gl";
import { MeshBasicMaterial } from "three";

const globe: GlobeInstance = new Globe(container, {
  animateIn: false,
  rendererConfig: { alpha: true, antialias: true },
});
```

- `polygonsData`, `polygonGeoJsonGeometry`, `polygonCapMaterial`,
  `polygonSideColor`, `polygonStrokeColor`, and `polygonAltitude` provide the
  continent/region geometry and appearance. Geographic coordinates use GeoJSON
  ordering (`longitude, latitude`); point-of-view and marker accessors use named
  `lat`/`lng` fields. A whole continent can be one `MultiPolygon` feature or
  several features mapped to one stable continent ID.
- `onPolygonHover((polygon, previous) => ...)` permits null values;
  `onPolygonClick((polygon, event, coords) => ...)` supplies the event and globe
  location. Callback data is typed as `object`, so narrow it at the application
  boundary rather than assuming application fields are present.
- `htmlElementsData`, `htmlElement`, `htmlLat`, and `htmlLng` support native
  elements/SVG icons. Visibility is managed for elements behind the globe;
  `htmlElementVisibilityModifier` can customize it.
- `pointOfView({ lat, lng, altitude }, transitionMs)` animates with cubic
  easing and chooses the shorter longitude direction. Reissuing it ends the
  prior point-of-view tween. `onZoom` follows OrbitControls changes, including
  rotation; its name does not mean every callback changes distance.
- `controls()` returns typed OrbitControls. The upstream globe enables damping,
  disables pan, and adjusts rotation/zoom speed with altitude. OrbitControls
  supplies one-finger rotation and two-finger dolly gestures. Native touch
  behavior still needs application-level acceptance testing.
- `getScreenCoords`, `toGlobeCoords`, `getCoords`, and `toGeoCoords` are the
  screen/geographic/3D coordinate bridge. Keep city isometric picking separate.
- `pauseAnimation`/`resumeAnimation` manage rendering. Gate `controls().enabled`,
  `enablePointerInteraction`, and the container's pointer events explicitly
  when transferring interaction to Phaser; pausing the animation loop is not a
  substitute for host input ownership.
- `_destructor()` is exposed in the published declarations and disposes the
  globe and render-object runtime. It is an underscored API: isolate its use in
  the host adapter. Construct the globe in its own container because upstream
  initialization clears that container's contents.

## Verification performed

- Published tarball SHA-512 and SHA-1 matched; copied source artifacts have
  recorded SHA-256 hashes.
- `npm ls globe.gl three @types/three three-globe three-render-objects` passed
  and showed the shared Three.js version.
- A browser-target esbuild import bundle completed without warnings.
- A strict TypeScript API smoke compilation passed for construction, polygon
  callbacks/material, animated camera, zoom callback, HTML elements, controls,
  and lifecycle methods. It used the project's `skipLibCheck` policy.

This verifies package integrity, dependency resolution, and API compatibility.
It does not establish rendering, touch, performance, or globe/city transition
correctness; those require the integrated application's browser checks.
