/** Locally authored declarations for the byte-exact upstream shots.js. */
import type { Easing } from "./easing.js";

export type ShotKey = "dive" | "descent" | "orbit" | "flyby" | "hyperzoom";
export interface ShotPreset {
  name: string;
  tagline: string;
  duration: number;
  sweep: number;
  endFov: number;
  endDistanceScale?: number;
  /** Distance/azimuth progress and authored degree-valued camera channels. */
  distance: Easing;
  pitch: Easing;
  azimuth: Easing;
  fov: Easing;
  roll: Easing;
  yaw?: Easing;
  tilt?: Easing;
  handheld?: number;
}
export interface ShotState {
  distance: number;
  /** Radians, as returned by the upstream samplers. */
  azimuth: number;
  pitch: number;
  roll: number;
  /** Vertical field of view in degrees. */
  fov: number;
  yaw: number;
  tilt: number;
  t?: number;
}
export interface ShotOptions {
  preset?: ShotKey;
  endAzimuth?: number;
  endDistance?: number;
  startDistance?: number;
  duration?: number;
  handheld?: number;
  seed?: number;
}
export interface SettleOptions {
  cruise?: number;
  settleTime?: number;
  turnTime?: number;
}
export interface ShotSampler {
  sample(time: number, out?: Partial<ShotState>): ShotState;
}
export interface BoundShot extends ShotSampler {
  preset: ShotKey;
  name: string;
  tagline: string;
  duration: number;
  startAzimuth: number;
  endAzimuth: number;
  startDistance: number;
  endDistance: number;
  settle(
    baseTime: number,
    options?: SettleOptions,
  ): ShotSampler & { baseTime: number };
  progress(time: number): number;
}

export declare const SPACE_DISTANCE: number;
export declare const NORTH_UP: number;
export declare const SHOTS: Record<ShotKey, ShotPreset>;
export declare const SHOT_KEYS: ShotKey[];
export declare function createShot(options?: ShotOptions): BoundShot;
export declare function createIdleShot(options?: {
  distance?: number;
  pitch?: number;
  fov?: number;
}): ShotSampler;
export declare function blendStates(
  a: ShotState,
  b: ShotState,
  alpha: number,
  out?: Partial<ShotState>,
): ShotState;
export declare function shortestAngle(from: number, to: number): number;
