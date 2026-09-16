import "./styles.css";
import { detectSupport } from "./support.js";

document.getElementById("retry")!.onclick = () => location.reload();

const support = detectSupport(new URLSearchParams(location.search).get("renderer"));
(window as unknown as { __AXP_SUPPORT: unknown }).__AXP_SUPPORT = support;

function showUnsupported(reasons: string[]): void {
  const screen = document.getElementById("unsupported")!;
  screen.hidden = false;
  document.getElementById("boot-card")!.hidden = true;
  document.getElementById("unsupported-reasons")!.textContent = reasons.join(" ");
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
      showUnsupported([`The city engine failed to start: ${error instanceof Error ? error.message : String(error)}`]);
    });
}
