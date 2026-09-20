import "./styles.css";
import { detectSupport } from "./support.js";
import shaderLabLicense from "../../assets/licenses/shader-lab-APACHE-2.0.txt?url";
import geistLicense from "../../assets/fonts/geist/OFL.txt?url";

// Keep the adapted component and font licenses in the distributed build.
for (const href of [shaderLabLicense, geistLicense]) {
  const link = document.createElement("link");
  link.rel = "license";
  link.href = href;
  document.head.append(link);
}

document.getElementById("retry")!.onclick = () => location.reload();

// Keep the compact native menu's light-dismiss and keyboard focus behavior.
const townMenu = document.getElementById("town-menu")!;
townMenu.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-action]")) {
    townMenu.hidePopover();
  }
});

const support = detectSupport(
  new URLSearchParams(location.search).get("renderer"),
);
(window as unknown as { __AXP_SUPPORT: unknown }).__AXP_SUPPORT = support;

function showUnsupported(reasons: string[]): void {
  const screen = document.getElementById("unsupported")!;
  screen.hidden = false;
  document.getElementById("boot-card")!.hidden = true;
  document.getElementById("unsupported-reasons")!.textContent =
    reasons.join(" ");
  document.getElementById("unsupported-ua")!.textContent = support.userAgent;
}

if (!support.renderer) {
  showUnsupported(support.reasons);
} else {
  if (support.renderer === "canvas") {
    const note = document.getElementById("boot-note")!;
    note.hidden = false;
    note.textContent = support.reasons.join(" ");
  }
  const renderer = support.renderer;
  // Phaser is only loaded once the browser has proven it can run it.
  import("./config.js")
    .then(({ createGame }) => createGame("game", renderer))
    .catch((error: unknown) => {
      showUnsupported([
        `The city engine failed to start: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    });
}
