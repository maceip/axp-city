import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const commit = process.env.AXP_BUILD_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
writeFileSync("dist/build-info.json", JSON.stringify({ commit, builtAt: new Date().toISOString() }));
