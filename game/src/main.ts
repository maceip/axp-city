import "./styles.css";
import { createGame } from "./config.js";
document.getElementById("retry")!.onclick = () => location.reload();
createGame("game");
