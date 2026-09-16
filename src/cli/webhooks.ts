// Backward-compatible service entry point: the same server now serves Phaser and the API.
import { runServer } from "./server.js";
void runServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
