import { fmt } from "./iso.js";

export type HumanPose = "walk" | "work" | "wave";

/**
 * Tiny isometric human figures (hardhat + vest) so human-activity lots read
 * as people, not the robot crew. Anchored bottom-center like sprite stamps.
 */
export function humanFigure(
  id: string,
  anchorX: number,
  anchorY: number,
  variant: number,
  pose: HumanPose = "walk",
): string {
  const hat = variant % 2 === 0 ? "#f0c14a" : "#d9e4ee";
  const vest = variant % 3 === 0 ? "#e85d04" : variant % 3 === 1 ? "#2a9d8f" : "#3d5a80";
  const pants = variant % 2 === 0 ? "#3a3f4b" : "#4a3728";
  const skin = "#e2b089";
  const scale = 0.92 + (variant % 3) * 0.06;
  const bob = pose === "work" ? 2 : pose === "wave" ? 1 : 3;
  const dur = pose === "walk" ? 0.7 : 1.1;
  return (
    `<g class="human-crew" data-pose="${pose}" transform="translate(${fmt(anchorX)} ${fmt(anchorY)}) scale(${fmt(scale)})">` +
    `<g>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${fmt(-bob)};0 0" ` +
    `keyTimes="0;0.5;1" dur="${dur}s" repeatCount="indefinite" begin="${fmt(-(variant % 5) * 0.2)}s"/>` +
    `<ellipse cx="0" cy="2" rx="7" ry="2.4" fill="rgba(40,40,40,0.28)"/>` +
    `<rect x="-3.2" y="-7" width="3.1" height="7" rx="0.6" fill="${pants}"/>` +
    `<rect x="0.4" y="-7" width="3.1" height="7" rx="0.6" fill="${pants}"/>` +
    `<rect x="-4.2" y="-16" width="8.4" height="10" rx="1.4" fill="${vest}"/>` +
    `<rect x="-4.2" y="-9" width="8.4" height="2.2" fill="#f4f1ea"/>` +
    `<circle cx="0" cy="-20" r="4.1" fill="${skin}"/>` +
    `<path d="M-4.6 -21.2 L4.6 -21.2 L3.4 -24.8 L-3.4 -24.8 Z" fill="${hat}"/>` +
    `<rect x="-5.6" y="-21.6" width="11.2" height="1.3" fill="${hat}"/>` +
    (pose === "wave"
      ? `<rect x="4.2" y="-18" width="2.2" height="7" rx="1" fill="${skin}" transform="rotate(-35 5 -14)"/>`
      : `<rect x="-6.2" y="-15" width="2.2" height="7" rx="1" fill="${skin}"/>` +
        `<rect x="4" y="-15" width="2.2" height="7" rx="1" fill="${skin}"/>`) +
    `</g></g>`
  );
}

/** A short sidewalk pace: human glides along world +x then mirrors back. */
export function pacingHuman(
  id: string,
  anchorX: number,
  anchorY: number,
  variant: number,
  dx: number,
  dy: number,
): string {
  const fig = humanFigure(id, 0, 0, variant, "walk");
  const dur = 6 + (variant % 3);
  return (
    `<g class="human-crew sidewalk">` +
    `<animateTransform attributeName="transform" type="translate" ` +
    `values="${fmt(anchorX)} ${fmt(anchorY)};${fmt(anchorX + dx)} ${fmt(anchorY + dy)};${fmt(anchorX)} ${fmt(anchorY)}" ` +
    `keyTimes="0;0.5;1" dur="${dur}s" repeatCount="indefinite"/>` +
    `<g>` +
    `<animateTransform attributeName="transform" type="scale" values="1 1;-1 1;1 1" ` +
    `keyTimes="0;0.5;1" calcMode="discrete" dur="${dur}s" repeatCount="indefinite"/>` +
    `${fig}` +
    `</g></g>`
  );
}
