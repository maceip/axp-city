import type Phaser from "phaser";
import type { CoreScene } from "../core/CoreScene.js";
import type { GlobeView } from "./GlobeView.js";
import type { AtlasRegion } from "./catalog.js";
import "./atlas.css";
import globeLicense from "../../../vendor/globe.gl/LICENSE?url";
import cinematicLicense from "../../../vendor/cinematic-world-zoom/LICENSE?url";
import iconLicense from "./icons/LICENSE?url";

/** Load the globe on demand; the existing town/save remains the local workshop. */
export function installAtlas(game: Phaser.Game): void {
  let globe: GlobeView | undefined;
  let loading: Promise<GlobeView> | undefined;
  let region: AtlasRegion | undefined;
  let transition = 0;
  const shell = document.getElementById("atlas-shell")!;
  const scene = () => game.scene.getScene("CoreCity") as CoreScene;
  const get = (id: string) => document.getElementById(id)!;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const href of [globeLicense, cinematicLicense, iconLicense]) {
    const link = document.createElement("link");
    link.rel = "license";
    link.href = href;
    document.head.append(link);
  }
  function setCityInput(active: boolean): void {
    document.body.dataset.atlasActive = String(!active);
    document
      .querySelectorAll<HTMLElement>(".topbar, .bottom-dock, .view-controls")
      .forEach((element) => (element.inert = !active));
    game.canvas.tabIndex = active ? 0 : -1;
    game.canvas.setAttribute("aria-hidden", String(!active));
    scene().setAtlasActive(!active);
  }
  function leaveGlobe(): void {
    const token = ++transition;
    globe?.hide();
    shell.inert = true;
    shell.classList.remove("atlas-arriving");
    shell.classList.add("atlas-departing");
    setCityInput(true);
    setTimeout(
      () => {
        if (transition !== token) return;
        shell.hidden = true;
        shell.classList.remove("atlas-departing");
        game.canvas.focus({ preventScroll: true });
      },
      reduced ? 0 : 460,
    );
  }
  function openTown(): void {
    region = undefined;
    scene().cameras.main.resetFX();
    scene().restoreLocalTown();
    document.body.dataset.repositoryDistrict = "false";
    get("district-navigation").hidden = true;
    get("atlas-error").hidden = true;
    leaveGlobe();
  }
  async function loadGlobe(): Promise<GlobeView> {
    if (globe) return globe;
    if (!loading)
      loading = Promise.all([import("./GlobeView.js"), import("./catalog.js")])
        .then(([{ GlobeView }, { createRegionWorld }]) => {
          globe = new GlobeView((destination) => {
            region = destination;
            const district = createRegionWorld(destination);
            scene().setRepositoryDistrict(
              district.world,
              district.repoByBuildingId,
            );
            document.body.dataset.repositoryDistrict = "true";
            get("district-navigation").hidden = false;
            get("district-back").textContent =
              `← ${globe!.atlas.continents.find((c) => c.id === destination.continentId)?.name ?? "World"}`;
            get("district-label").textContent =
              `${destination.name} · ${destination.repos.length} ${destination.repos.length === 1 ? "repository" : "repositories"}`;
            leaveGlobe();
            if (!reduced) {
              const camera = scene().cameras.main;
              const zoom = camera.zoom;
              camera.setZoom(zoom * 0.8);
              camera.zoomTo(zoom, 650, "Sine.easeOut", true);
            }
          }, openTown);
          return globe;
        })
        .catch((error) => {
          loading = undefined;
          throw error;
        });
    return loading;
  }
  async function openWorld(): Promise<void> {
    const token = ++transition;
    const fadeFromCity = Boolean(globe) && shell.hidden && !reduced;
    scene().cameras.main.resetFX();
    get("town-menu").hidePopover();
    shell.hidden = false;
    shell.inert = false;
    shell.classList.remove("atlas-departing");
    shell.classList.toggle("atlas-arriving", fadeFromCity);
    get("atlas-hint").textContent = "Preparing the repository world…";
    setCityInput(false);
    // Keep the last city composition visible beneath the returning globe for
    // the crossfade. Input and simulation presentation already belong to the atlas.
    if (fadeFromCity) scene().cameras.main.visible = true;
    try {
      const view = await loadGlobe();
      if (transition !== token) return;
      view.show(region);
      if (fadeFromCity) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (transition !== token) return;
            shell.classList.remove("atlas-arriving");
            setTimeout(() => {
              if (transition === token) scene().cameras.main.visible = false;
            }, 460);
          }),
        );
      }
      shell
        .querySelector<HTMLCanvasElement>("canvas")
        ?.focus({ preventScroll: true });
    } catch (error) {
      if (transition !== token) return;
      shell.classList.remove("atlas-arriving");
      scene().cameras.main.visible = false;
      get("atlas-error-message").textContent =
        error instanceof Error
          ? error.message
          : "This browser could not create the 3D globe.";
      get("atlas-error").hidden = false;
    }
  }
  get("open-world").onclick = () => void openWorld();
  get("district-back").onclick = () => void openWorld();
  get("district-town").onclick = get("atlas-error-close").onclick = openTown;
  // These controls remain usable even while the lazy-loaded module is arriving.
  get("atlas-town").onclick = openTown;
  scene().onAtlasRequested = () => void openWorld();
  if (new URLSearchParams(location.search).get("view") === "world") {
    // Phaser's create finishes before its first poststep; keep the normal town boot intact.
    game.events.once("poststep", () => void openWorld());
  }
  import.meta.hot?.dispose(() => {
    ++transition;
    globe?.destroy();
  });
}
