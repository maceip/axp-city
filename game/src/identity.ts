import type { CityIdentity } from "../../src/live/protocol.js";

/**
 * One Phaser client, two city modes. Shell copy follows the snapshot so
 * fixture AXP City and live Trending City do not share a hardcoded title.
 */
export function cityDisplayName(city?: CityIdentity | null): string {
  const name = city?.name?.trim();
  return name && name.length ? name : "AXP City";
}

export function applyCityIdentity(city?: CityIdentity | null): void {
  const name = cityDisplayName(city);
  const trending = city?.kind === "trending";
  document.title = name;
  const game = document.getElementById("game");
  if (game) game.setAttribute("aria-label", `${name}, an interactive isometric GitHub city`);
  const eyebrow = document.querySelector("#boot-card .eyebrow");
  if (eyebrow) eyebrow.textContent = `WELCOME TO ${name.toUpperCase()}`;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (meta) {
    meta.content = trending
      ? `${name} — daily, weekly, and monthly GitHub projects as an isometric city.`
      : `${name} — a shared isometric city built from GitHub repositories.`;
  }
}
