import { runServer } from "./server.js";
void runServer(["--core", ...process.argv.slice(2)]).catch((error) => {
  console.error(error);
  process.exit(1);
});
