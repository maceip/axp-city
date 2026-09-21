import Globe from "globe.gl";
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  MeshPhongMaterial,
  type PerspectiveCamera,
} from "three";
import { CinematicCamera, type GlobePov } from "./CinematicCamera.js";
import {
  buildAtlas,
  catalog,
  type AtlasContinent,
  type AtlasRegion,
} from "./catalog.js";
import javascript from "./icons/javascript.svg?url";
import typescript from "./icons/typescript.svg?url";
import python from "./icons/python.svg?url";
import go from "./icons/go.svg?url";
import rust from "./icons/rust.svg?url";
import kotlin from "./icons/kotlin.svg?url";
import java from "./icons/java.svg?url";
import cpp from "./icons/cplusplus.svg?url";
import html from "./icons/html.svg?url";

const icons: Record<string, string> = {
  JavaScript: javascript,
  TypeScript: typescript,
  Python: python,
  Go: go,
  Rust: rust,
  Kotlin: kotlin,
  Java: java,
  "C++": cpp,
  HTML: html,
};
type Place = AtlasContinent | AtlasRegion;
const isRegion = (place: Place): place is AtlasRegion => "continentId" in place;
const el = (id: string) => document.getElementById(id)!;
const angularDistance = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) => {
  const r = Math.PI / 180;
  return (
    Math.acos(
      Math.min(
        1,
        Math.max(
          -1,
          Math.sin(a.lat * r) * Math.sin(b.lat * r) +
            Math.cos(a.lat * r) *
              Math.cos(b.lat * r) *
              Math.cos((a.lng - b.lng) * r),
        ),
      ),
    ) / r
  );
};

/** Globe owns spherical camera/picking. City owns its independent integer grid. */
export class GlobeView {
  readonly atlas = buildAtlas(catalog);
  private globe: InstanceType<typeof Globe>;
  private cinematic: CinematicCamera;
  private updatingCamera = false;
  private continent?: AtlasContinent;
  private hovered?: Place;
  private polygonHovered?: Place;
  private markerHovered?: Place;
  private active = false;
  private contextLost = false;
  private entering = false;
  private flightUntil = 0;
  private zoomTarget?: number;
  private markerElements = new Map<string, HTMLElement>();
  private landMaterials = new Map<string, MeshPhongMaterial>();
  private cleanup: Array<() => void> = [];
  private reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  private level: "world" | "regions" = "world";

  constructor(
    private enterDistrict: (region: AtlasRegion) => void,
    private openTown: () => void,
  ) {
    const container = el("atlas-canvas");
    this.globe = new Globe(container, {
      animateIn: false,
      rendererConfig: {
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      },
    })
      .width(innerWidth)
      .height(innerHeight)
      .backgroundColor("rgba(0,0,0,0)")
      .globeMaterial(
        new MeshPhongMaterial({
          color: "#163c4c",
          emissive: "#061622",
          specular: "#477d89",
          shininess: 32,
        }),
      )
      .showAtmosphere(true)
      .atmosphereColor("#80c8d0")
      .atmosphereAltitude(0.105)
      .globeCurvatureResolution(2)
      // D3's spherical tessellator uses clockwise outer rings (opposite RFC 7946).
      // Keep the model's GeoJSON standard and adapt only at the renderer boundary.
      .polygonGeoJsonGeometry(
        (place: object) =>
          ({
            type: "Polygon",
            coordinates: (place as Place).geometry.coordinates.map((ring) =>
              [...ring].reverse(),
            ),
          }) as unknown as { type: string; coordinates: number[] },
      )
      .polygonCapCurvatureResolution(2)
      .polygonLabel(() => "")
      .polygonAltitude((place: object) => this.altitude(place as Place))
      .polygonCapColor((place: object) => this.color(place as Place))
      .polygonCapMaterial((place: object) => this.landMaterial(place as Place))
      .polygonSideColor(() => "#315c56")
      .polygonStrokeColor((place: object) =>
        this.hovered?.id === (place as Place).id ? "#f1f7d6" : "#87b6a099",
      )
      .polygonsTransitionDuration(this.reduceMotion ? 0 : 180)
      .onPolygonHover((place) => {
        this.polygonHovered = (place as Place | null) ?? undefined;
        this.highlight(this.markerHovered ?? this.polygonHovered ?? null);
      })
      .onPolygonClick((place) => this.choose(place as Place))
      .htmlLat("lat")
      .htmlLng("lng")
      .htmlAltitude(0.045)
      .htmlElement((place: object) => this.marker(place as Place))
      .htmlElementVisibilityModifier((element, visible) => {
        element.style.opacity = visible ? "1" : "0";
        element.style.visibility = visible ? "visible" : "hidden";
        element.style.pointerEvents = visible ? "auto" : "none";
        element.setAttribute("aria-hidden", String(!visible));
        const button = element.querySelector("button");
        if (button) button.tabIndex = visible ? 0 : -1;
      })
      .onZoom((pov) => this.onZoom(pov));
    const ambient = new HemisphereLight("#f1ffe5", "#324252", 2.15);
    const sun = new DirectionalLight("#fff0ce", 2.1);
    sun.position.set(-160, 210, 220);
    this.globe.lights([ambient, sun]);
    this.globe.renderer().setPixelRatio(Math.min(devicePixelRatio, 2));
    this.globe.controls().minDistance = this.globe.getGlobeRadius() * 1.13;
    this.globe.controls().maxDistance =
      this.globe.getGlobeRadius() * (this.worldAltitude() + 2);
    this.globe.controls().dampingFactor = 0.09;
    this.globe.controls().zoomToCursor = false;
    this.globe.pointOfView({
      lat: 15,
      lng: -22,
      altitude: this.worldAltitude(),
    });
    this.cinematic = new CinematicCamera(
      this.globe.camera() as PerspectiveCamera,
      this.globe.getGlobeRadius(),
      () => {
        // Globe.gl's public control event refreshes marker occlusion/picking.
        // Suppress semantic zoom while the cinematic rig owns the camera.
        this.updatingCamera = true;
        this.globe.controls().dispatchEvent({ type: "change" });
        this.updatingCamera = false;
        const flight = this.cinematic.snapshot;
        el("atlas-shell").dataset.flightLabels =
          flight.active &&
          flight.kind !== "zoom" &&
          (flight.kind === "dive" || flight.progress < 0.65)
            ? "hidden"
            : "visible";
      },
      this.reduceMotion,
    );
    this.cinematic.setActive(false);
    this.renderLevel();
    const canvas = container.querySelector("canvas")!;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Repository globe");
    const listen = (
      target: EventTarget,
      name: string,
      fn: EventListener,
      capture = false,
    ) => {
      target.addEventListener(name, fn, capture);
      this.cleanup.push(() => target.removeEventListener(name, fn, capture));
    };
    listen(window, "resize", () => {
      this.globe.width(innerWidth).height(innerHeight);
      this.globe.renderer().setPixelRatio(Math.min(devicePixelRatio, 2));
      this.globe.controls().maxDistance =
        this.globe.getGlobeRadius() * (this.worldAltitude() + 2);
      if (this.active && !this.entering) {
        if (this.continent) this.focusContinent(this.continent);
        else this.world();
      }
    });
    listen(document, "visibilitychange", () => {
      this.cinematic.setActive(
        !document.hidden && this.active && !this.contextLost,
      );
      if (document.hidden || !this.active || this.contextLost)
        this.globe.pauseAnimation();
      else this.globe.resumeAnimation();
    });
    listen(window, "keydown", ((event: KeyboardEvent) => {
      if (
        !this.active ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        document.querySelector("[popover]:popover-open") ||
        (event.target as HTMLElement).matches(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (event.key === "Escape") this.world();
      if (event.key === "+" || event.key === "=") this.zoom(0.68);
      if (event.key === "-") this.zoom(1.45);
    }) as EventListener);
    listen(canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.stopFlight();
      this.cinematic.setActive(false);
      this.globe.pauseAnimation();
      el("atlas-error-message").textContent =
        "The globe’s graphics connection was interrupted. Your town is still available.";
      el("atlas-error").hidden = !this.active;
    });
    listen(canvas, "webglcontextrestored", () => {
      this.contextLost = false;
      this.cinematic.setActive(this.active && !document.hidden);
      this.globe.controls().enabled = this.active;
      if (this.active && !document.hidden) this.globe.resumeAnimation();
      el("atlas-error").hidden = true;
    });
    const interruptFlight = (event: Event) => {
      // Marker clicks may retarget a flight continuously; canvas gestures take
      // control immediately, before OrbitControls sees the same input event.
      if ((event.target as HTMLElement).closest("button")) return;
      if (!this.cinematic.active) return;
      this.stopFlight();
      this.flightUntil = performance.now() + 500;
      el("atlas-hint").textContent =
        this.level === "world"
          ? "Drag to rotate. Select a language to explore."
          : "Select a tag region, or keep scrolling closer.";
    };
    listen(container, "wheel", interruptFlight, true);
    listen(container, "pointerdown", interruptFlight, true);
    listen(container, "touchmove", interruptFlight, true);
    el("atlas-home").onclick = el("atlas-world").onclick = () => this.world();
    el("atlas-continent").onclick = () => {
      if (this.continent) this.focusContinent(this.continent);
    };
    el("atlas-in").onclick = () => this.zoom(0.68);
    el("atlas-out").onclick = () => this.zoom(1.45);
    el("atlas-town").onclick = () => this.openTown();
    const languages = el("atlas-languages");
    languages.replaceChildren(
      ...this.atlas.continents.map((continent) => {
        const button = document.createElement("button");
        button.className = "sl-menu-item";
        button.textContent = `${continent.name} · ${continent.repoCount}`;
        button.onclick = () => {
          languages.hidePopover();
          this.focusContinent(continent);
        };
        return button;
      }),
    );
    el("atlas-source").textContent =
      `${catalog.label} · ${this.atlas.repoCount} repositories · ${catalog.capturedAt.slice(0, 10)}`;
    (window as unknown as { __ATLAS: unknown }).__ATLAS = {
      snapshot: () => ({
        active: this.active,
        level: this.level,
        entering: this.entering,
        continent: this.continent?.id ?? null,
        hovered: this.hovered?.id ?? null,
        pov: this.globe.pointOfView(),
        cinematic: this.cinematic.snapshot,
        continents: this.atlas.continents.map((c) => ({
          id: c.id,
          name: c.name,
          lat: c.lat,
          lng: c.lng,
          repoCount: c.repoCount,
          regions: c.regions.map((r) => ({
            id: r.id,
            name: r.name,
            lat: r.lat,
            lng: r.lng,
            repos: r.repos.length,
          })),
        })),
        visibleBuildings: 0,
      }),
      screen: (id: string) => {
        const place = [...this.atlas.continents, ...this.atlas.regions].find(
          (p) => p.id === id,
        );
        return place
          ? this.globe.getScreenCoords(place.lat, place.lng, 0.045)
          : null;
      },
    };
    this.globe.pauseAnimation();
  }

  private worldAltitude(): number {
    const radius = Math.min(innerWidth * 0.42, innerHeight * 0.36);
    return Math.max(
      2.25,
      Math.sqrt(1 + (this.focalLength() / radius) ** 2) - 1,
    );
  }
  private focalLength(): number {
    // Framing/LOD use the settled lens, independent of an in-flight lens change.
    return innerHeight / (2 * Math.tan((50 * Math.PI) / 360));
  }
  private continentAltitude(continent: AtlasContinent): number {
    const ring = continent.geometry.coordinates[0];
    const radians = Math.PI / 180;
    const halfLng =
      Math.max(...ring.map((p) => Math.abs(p[0] - continent.lng))) *
      Math.cos(continent.lat * radians) *
      radians;
    const halfLat =
      Math.max(...ring.map((p) => Math.abs(p[1] - continent.lat))) * radians;
    const fit = (angle: number, room: number) =>
      Math.cos(angle) + (Math.sin(angle) * this.focalLength()) / room - 1;
    return Math.max(
      0.75,
      fit(
        halfLng,
        Math.max(70, Math.min(innerWidth * 0.3, innerWidth / 2 - 75)),
      ),
      fit(halfLat, innerHeight * 0.36),
    );
  }
  private color(place: Place): string {
    const color = new Color(place.color).lerp(new Color("#86b7a0"), 0.55);
    if (this.hovered?.id === place.id) color.lerp(new Color("#f2f7cb"), 0.5);
    if (this.level === "regions" && !isRegion(place))
      color.multiplyScalar(0.55);
    return `#${color.getHexString()}`;
  }
  private altitude(place: Place): number {
    return (
      (isRegion(place) ? 0.019 : 0.011) +
      (this.hovered?.id === place.id ? 0.009 : 0)
    );
  }
  private landMaterial(place: Place): MeshPhongMaterial {
    let material = this.landMaterials.get(place.id);
    if (!material) {
      material = new MeshPhongMaterial({ shininess: 5, specular: "#456658" });
      // Caps sit on a sphere: radial normals avoid visible triangulation seams.
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\nobjectNormal = normalize(position);",
        );
      };
      this.landMaterials.set(place.id, material);
    }
    material.color.set(this.color(place));
    return material;
  }
  private marker(place: Place): HTMLElement {
    let wrapper = this.markerElements.get(place.id);
    if (wrapper) return wrapper;
    wrapper = document.createElement("div");
    wrapper.className = "atlas-marker";
    const button = document.createElement("button");
    button.className = isRegion(place) ? "atlas-tag" : "atlas-language";
    button.dataset.placeId = place.id;
    button.setAttribute(
      "aria-label",
      isRegion(place)
        ? `Explore ${place.name} repositories`
        : `Explore ${place.name} continent`,
    );
    button.title = isRegion(place)
      ? `${place.name} · ${place.repos.length} repositories`
      : place.name;
    if (isRegion(place)) {
      wrapper.classList.add("atlas-region-marker");
      const index = this.atlas.continents
        .find((c) => c.id === place.continentId)!
        .regions.findIndex((r) => r.id === place.id);
      wrapper.style.setProperty("--tag-offset", index % 2 ? "33px" : "-33px");
      wrapper.style.setProperty("--stem-offset", index % 2 ? "0px" : "-33px");
      const name = document.createElement("span");
      name.textContent = place.name;
      const count = document.createElement("small");
      count.textContent = String(place.repos.length);
      button.append(name, count);
    } else {
      const icon = icons[place.language ?? ""];
      if (icon) {
        const img = document.createElement("img");
        img.src = icon;
        img.alt = "";
        if (place.language === "Rust") img.style.filter = "invert(1)";
        img.draggable = false;
        button.append(img);
      } else button.textContent = place.name.slice(0, 2);
    }
    const enterMarker = () => {
      this.markerHovered = place;
      this.highlight(place);
    };
    const leaveMarker = () => {
      this.markerHovered = undefined;
      this.highlight(this.polygonHovered ?? null);
    };
    button.onpointerenter = enterMarker;
    button.onpointerleave = leaveMarker;
    button.onfocus = enterMarker;
    button.onblur = leaveMarker;
    // Prevent OrbitControls from starting a drag on an accessible marker button.
    button.onpointerdown = (event) => event.stopPropagation();
    button.onclick = (event) => {
      event.stopPropagation();
      this.choose(place);
    };
    wrapper.append(button);
    this.markerElements.set(place.id, wrapper);
    return wrapper;
  }
  private highlight(place: Place | null): void {
    if (this.entering || this.cinematic.active) return;
    if (this.level === "regions" && place && !isRegion(place)) place = null;
    if (this.hovered?.id === place?.id) return;
    this.hovered = place ?? undefined;
    this.globe
      .polygonCapMaterial((p) => this.landMaterial(p as Place))
      .polygonAltitude((p) => this.altitude(p as Place))
      .polygonStrokeColor((p) =>
        this.hovered?.id === (p as Place).id ? "#f1f7d6" : "#87b6a099",
      );
    el("atlas-hint").textContent = place
      ? `${place.name} · ${isRegion(place) ? place.repos.length : place.repoCount} repositories — select to explore`
      : this.level === "world"
        ? "Drag to rotate. Select a language to explore."
        : "Select a tag region, or keep scrolling closer.";
  }
  private choose(place: Place): void {
    if (!this.active || this.contextLost || this.entering) return;
    if (isRegion(place)) this.enter(place);
    else this.focusContinent(place);
  }
  focusContinent(continent: AtlasContinent): void {
    if (this.contextLost) return;
    this.entering = false;
    this.continent = continent;
    this.level = "regions";
    this.renderLevel();
    this.fly(
      {
        lat: continent.lat,
        lng: continent.lng,
        altitude: this.continentAltitude(continent),
      },
      1400,
      "descent",
    );
  }
  private fly(
    pov: Partial<GlobePov> & { altitude: number },
    duration: number,
    kind: "descent" | "dive" | "return" | "zoom",
    complete?: () => void,
  ): void {
    if (this.contextLost) return;
    this.zoomTarget = kind === "zoom" ? pov.altitude : undefined;
    const controls = this.globe.controls();
    const camera = this.globe.camera();
    // Drain residual drag/pinch damping before taking over. Restore the exact
    // displayed pose so a click during a gesture does not jump on its first frame.
    const position = camera.position.clone();
    const quaternion = camera.quaternion.clone();
    this.updatingCamera = true;
    controls.enabled = false;
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    camera.updateMatrixWorld();
    this.updatingCamera = false;
    this.flightUntil = 0;
    el("atlas-shell").dataset.flying = "true";
    this.cinematic.flyTo(
      { ...this.globe.pointOfView(), ...pov },
      {
        kind,
        durationMs: duration,
        onComplete: () => {
          controls.enabled = true;
          this.zoomTarget = undefined;
          el("atlas-shell").dataset.flying = "false";
          if (complete) complete();
          else if (kind === "zoom") this.onZoom(this.globe.pointOfView());
        },
      },
    );
  }
  private enter(region: AtlasRegion): void {
    if (this.entering) return;
    this.entering = true;
    el("atlas-hint").textContent = `Entering ${region.name}…`;
    this.fly(
      { lat: region.lat, lng: region.lng, altitude: 0.18 },
      1600,
      "dive",
      () => {
        if (!this.active || !this.entering) return;
        this.entering = false;
        this.enterDistrict(region);
      },
    );
  }
  private stopFlight(): void {
    this.entering = false;
    this.zoomTarget = undefined;
    this.cinematic.cancel();
    this.globe.controls().enabled = this.active && !this.contextLost;
    el("atlas-shell").dataset.flying = "false";
    el("atlas-shell").dataset.flightLabels = "visible";
  }
  private onZoom(pov: { lat: number; lng: number; altitude: number }): void {
    if (
      !this.active ||
      this.contextLost ||
      this.updatingCamera ||
      this.cinematic?.active ||
      this.entering
    )
      return;
    if (
      this.level === "regions" &&
      this.continent &&
      pov.altitude > this.continentAltitude(this.continent) * 1.55
    ) {
      this.level = "world";
      this.continent = undefined;
      this.renderLevel();
      return;
    }
    if (this.level === "world") {
      const nearest = [...this.atlas.continents].sort(
        (a, b) => angularDistance(pov, a) - angularDistance(pov, b),
      )[0];
      if (
        nearest &&
        pov.altitude < this.continentAltitude(nearest) * 1.2 &&
        angularDistance(pov, nearest) < 35
      ) {
        this.continent = nearest;
        this.level = "regions";
        this.renderLevel();
      }
    }
    if (
      this.level === "regions" &&
      this.continent &&
      performance.now() >= this.flightUntil &&
      pov.altitude < 0.4
    ) {
      const nearest = [...this.continent.regions].sort(
        (a, b) => angularDistance(pov, a) - angularDistance(pov, b),
      )[0];
      if (nearest && angularDistance(pov, nearest) < 18) this.enter(nearest);
    }
  }
  private renderLevel(): void {
    this.hovered = undefined;
    this.polygonHovered = undefined;
    this.markerHovered = undefined;
    const regions =
      this.level === "regions" && this.continent ? this.continent.regions : [];
    this.globe.polygonsData([...this.atlas.continents, ...regions]);
    this.globe.htmlElementsData(
      regions.length ? regions : this.atlas.continents,
    );
    el("atlas-level").textContent =
      this.level === "world" ? "World" : "Regions";
    el("atlas-title").textContent = this.continent
      ? this.continent.name
      : "A world built from code.";
    el("atlas-hint").textContent = this.continent
      ? "Select a tag region, or keep scrolling closer."
      : "Drag to rotate. Select a language to explore.";
    el("atlas-continent").hidden = el("atlas-separator").hidden =
      !this.continent;
    el("atlas-continent").textContent = this.continent?.name ?? "";
    el("atlas-shell").dataset.level = this.level;
  }
  private zoom(factor: number): void {
    if (this.contextLost) return;
    if (this.entering) {
      if (factor > 1) this.entering = false;
      else return;
    }
    const pov = this.globe.pointOfView();
    const altitude = Math.min(
      this.worldAltitude() + 1,
      Math.max(0.14, (this.zoomTarget ?? pov.altitude) * factor),
    );
    // Button zoom follows the same LOD thresholds as wheel and pinch.
    this.fly({ altitude }, 360, "zoom");
  }
  world(): void {
    if (this.contextLost) return;
    this.entering = false;
    this.continent = undefined;
    this.level = "world";
    this.renderLevel();
    this.fly({ altitude: this.worldAltitude() }, 1250, "return");
  }
  show(region?: AtlasRegion): void {
    this.active = true;
    this.cinematic.setActive(!document.hidden && !this.contextLost);
    el("atlas-error").hidden = !this.contextLost;
    this.globe.controls().enabled = !this.contextLost;
    if (!this.contextLost && !document.hidden) this.globe.resumeAnimation();
    if (region) {
      const continent = this.atlas.continents.find(
        (c) => c.id === region.continentId,
      );
      if (continent) {
        this.entering = false;
        this.continent = continent;
        this.level = "regions";
        this.renderLevel();
        this.fly(
          {
            lat: continent.lat,
            lng: continent.lng,
            altitude: this.continentAltitude(continent),
          },
          1400,
          "return",
        );
      }
    }
  }
  hide(): void {
    this.active = false;
    this.stopFlight();
    this.cinematic.setActive(false);
    this.globe.pauseAnimation();
    el("atlas-languages").hidePopover();
  }
  destroy(): void {
    this.hide();
    this.cinematic.destroy();
    this.cleanup.forEach((fn) => fn());
    this.globe._destructor();
  }
}
