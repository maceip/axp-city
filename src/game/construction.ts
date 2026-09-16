import { CONSTRUCTION_MS } from "../world/constants.js";
import type { LotPlacement } from "../world/layout.js";

/**
 * Staged construction shared by the Phaser scene and the SVG export. Every
 * stage is a pure function of the server's `addedAt` timestamp and the
 * (server-synchronised) clock, so visitors who arrive at different moments,
 * or who pan away and return, see the same progress.
 */
export type ConstructionStage =
  | "grading"
  | "framing"
  | "cladding"
  | "finishing"
  | "complete";

export interface ConstructionState {
  stage: ConstructionStage;
  /** 0..1 across the whole construction window. */
  progress: number;
  /** 0..1 inside the current stage. */
  stageProgress: number;
  /** Scaffold height fraction (0 = none, 1 = full band height). */
  scaffold: number;
  /** Building alpha for this moment of the sequence. */
  buildingAlpha: number;
  /** Crane is present during framing and cladding. */
  crane: boolean;
  /** Cones and graded dirt are present until finishing. */
  siteDressing: boolean;
  /** Milliseconds until the sequence completes (0 when complete). */
  remainingMs: number;
}

const STAGES: Array<[ConstructionStage, number]> = [
  ["grading", 0.18],
  ["framing", 0.5],
  ["cladding", 0.82],
  ["finishing", 1],
];

export function constructionState(
  place: Pick<LotPlacement, "addedAt" | "constructing">,
  now: number,
): ConstructionState {
  const complete: ConstructionState = {
    stage: "complete",
    progress: 1,
    stageProgress: 1,
    scaffold: 0,
    buildingAlpha: 1,
    crane: false,
    siteDressing: false,
    remainingMs: 0,
  };
  if (!place.addedAt) return place.constructing ? started(0) : complete;
  const at = Date.parse(place.addedAt);
  if (Number.isNaN(at)) return complete;
  const elapsed = now - at;
  if (elapsed >= CONSTRUCTION_MS || elapsed < 0) return complete;
  return started(elapsed / CONSTRUCTION_MS, CONSTRUCTION_MS - elapsed);
}

function started(progress: number, remainingMs = CONSTRUCTION_MS): ConstructionState {
  let from = 0;
  for (const [stage, until] of STAGES) {
    if (progress < until) {
      const stageProgress = (progress - from) / (until - from);
      return {
        stage,
        progress,
        stageProgress,
        scaffold:
          stage === "grading"
            ? 0
            : stage === "framing"
              ? stageProgress
              : stage === "cladding"
                ? 1
                : 1 - stageProgress,
        buildingAlpha:
          stage === "grading"
            ? 0
            : stage === "framing"
              ? 0.12
              : stage === "cladding"
                ? 0.12 + 0.68 * stageProgress
                : 0.8 + 0.2 * stageProgress,
        crane: stage === "framing" || stage === "cladding",
        siteDressing: stage !== "finishing",
        remainingMs,
      };
    }
    from = until;
  }
  return started(0.999, remainingMs);
}

export function constructionLabel(state: ConstructionState): string {
  switch (state.stage) {
    case "grading":
      return "Grading the site";
    case "framing":
      return "Raising the frame";
    case "cladding":
      return "Cladding the building";
    case "finishing":
      return "Finishing touches";
    default:
      return "Complete";
  }
}
