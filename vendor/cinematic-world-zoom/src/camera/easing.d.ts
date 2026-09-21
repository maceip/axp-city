/** Locally authored declarations for the byte-exact upstream easing.js. */
export type Easing = (time: number) => number;
export interface DampedState {
  value: number;
  rate: number;
}
export type TrackKey = readonly [time: number, value: number, ease?: Easing];
export type SmoothTrackKey = readonly [time: number, value: number];

export declare const smoothstep: Easing;
export declare const smootherstep: Easing;
export declare const cubicInOut: Easing;
export declare const sineInOut: Easing;
export declare const bezier: (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) => Easing;
export declare const delayed: (start?: number, ease?: Easing) => Easing;
export declare const cinematic: Easing;
export declare const coast: Easing;
export declare const coastFromRest: Easing;
export declare const clamp01: Easing;
export declare const settleSpan: (tau: number, time: number) => number;
export declare const mixLog: (a: number, b: number, time: number) => number;
export declare const damp: (
  state: DampedState,
  target: number,
  smoothTime: number,
  dt: number,
) => number;
export declare const track: (
  keys: readonly TrackKey[],
  ease?: Easing,
) => Easing;
export declare const smoothTrack: (
  keys: readonly SmoothTrackKey[],
  endCoast?: number,
) => Easing;
