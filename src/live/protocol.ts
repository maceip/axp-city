import type { CityPlan, LotPlacement } from "../world/layout.js";
export interface CitySnapshot {
  version: 1;
  revision: number;
  serverTime: string;
  mode: "live" | "offline";
  plan: CityPlan;
}
export interface CityMutation {
  type: "lot_added" | "lot_updated";
  revision: number;
  serverTime: string;
  placement: LotPlacement;
  geometry?: Omit<CityPlan, "placements">;
}
