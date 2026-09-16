import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCityStore } from "../src/live/cityStore.js";
import { parseCity } from "../src/parser/index.js";
import { authorizeAdmin, secretMatches } from "../src/webhooks/auth.js";
import { FIXED_NOW, metrics } from "./helpers.js";

describe("secretMatches", () => {
  it("accepts the expected token and rejects others, including empty", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abc", "xyz")).toBe(false);
    expect(secretMatches("", "abc")).toBe(false);
    expect(secretMatches("abc", "")).toBe(false);
  });
});

describe("authorizeAdmin", () => {
  it("requires a bearer token and never infers success from a missing config", () => {
    expect(
      authorizeAdmin({ authorization: "Bearer secret" }, "secret").ok,
    ).toBe(true);
    expect(authorizeAdmin({ authorization: "Bearer nope" }, "secret").ok).toBe(
      false,
    );
    expect(authorizeAdmin({}, "secret").ok).toBe(false);
    expect(authorizeAdmin({ authorization: "Bearer secret" }, "").ok).toBe(
      false,
    );
  });
});

describe("createCityStore", () => {
  it("assigns a sticky plot and emits construction for a brand-new repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axp-city-"));
    const store = createCityStore(join(dir, "city-map.json"));
    await store.load();
    const first = parseCity([metrics({ fullName: "acme/alpha", stars: 100 })], {
      now: FIXED_NOW,
    });
    await store.hydrate(first);
    const again = await store.ensure("acme/alpha");
    expect(again).toBeNull();
    const added = await store.ensure(
      "acme/fresh",
      parseCity([metrics({ fullName: "acme/fresh" })])[0],
    );
    expect(added?.type).toBe("lot_added");
    expect(added?.placement.lot.fullName).toBe("acme/fresh");
    expect(added?.placement.constructing).toBe(true);
    expect(added).not.toHaveProperty("svg");
    expect(store.lots().map((l) => l.fullName)).toEqual([
      "acme/alpha",
      "acme/fresh",
    ]);
    const reloaded = createCityStore(join(dir, "city-map.json"));
    await reloaded.load();
    expect(reloaded.lots().map((l) => l.fullName)).toEqual([
      "acme/alpha",
      "acme/fresh",
    ]);
  });
});
