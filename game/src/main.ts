import "./styles.css";
import { createGame, detectSupport } from "./config.js";

document.getElementById("retry")!.onclick = () => location.reload();

const support = detectSupport(new URLSearchParams(location.search).get("renderer"));
(window as unknown as { __AXP_SUPPORT: unknown }).__AXP_SUPPORT = support;
if (!support.renderer) {
  const screen = document.getElementById("unsupported")!;
  screen.hidden = false;
  document.getElementById("boot-card")!.hidden = true;
  document.getElementById("unsupported-reasons")!.textContent = support.reasons.join(" ");
  document.getElementById("unsupported-ua")!.textContent = support.userAgent;
} else {
  if (support.renderer === "canvas") {
    const note = document.getElementById("boot-note")!;
    note.hidden = false;
    note.textContent = support.reasons.join(" ");
  }
  createGame("game", support.renderer);
}
