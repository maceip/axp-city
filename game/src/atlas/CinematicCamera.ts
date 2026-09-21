import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from "three";
import { SHOTS } from "../../../vendor/cinematic-world-zoom/src/camera/shots.js";
import {
  cinematic,
  clamp01,
  mixLog,
  smootherstep,
} from "../../../vendor/cinematic-world-zoom/src/camera/easing.js";

/** Camera channels and analytic ENU basis adapted from David Ronai's MIT rig.
 * See vendor/cinematic-world-zoom/LICENSE. Distances here use the atlas radius,
 * not Earth metres; the vendored shot factory's forced 10x descent is omitted. */
export const BASE_FOV = 50;
export type GlobePov = { lat: number; lng: number; altitude: number };
export type FlightKind = "descent" | "dive" | "return" | "zoom";
export interface CameraPose {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  fov: number;
}
export interface FlightPose {
  position: Vector3;
  quaternion: Quaternion;
  /** Keep OrbitControls' original Y-up convention, even while banking. */
  up: Vector3;
  fov: number;
  progress: number;
  altitude: number;
  /** Radians; useful for diagnostics of the authored channels. */
  pitch: number;
  roll: number;
}
export interface FlightOptions {
  kind: FlightKind;
  durationMs: number;
  onComplete?: () => void;
}

const radians = Math.PI / 180;
const worldUp = new Vector3(0, 1, 0);
const identity = new Quaternion();

function surfaceDirection(lat: number, lng: number): Vector3 {
  const phi = lat * radians;
  const lambda = lng * radians;
  return new Vector3(
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
    Math.cos(phi) * Math.cos(lambda),
  );
}

/** A deterministic shortest great circle, including coincident/antipodal ends. */
function greatCircle(from: Vector3, to: Vector3, t: number) {
  const dot = Math.max(-1, Math.min(1, from.dot(to)));
  const tangent = to.clone().addScaledVector(from, -dot);
  const length = tangent.length();
  let angle = Math.atan2(length, dot);
  if (length < 1e-12) {
    if (dot > 0)
      return {
        direction: from.clone(),
        rotation: new Quaternion(),
        endRotation: new Quaternion(),
      };
    // Longitude cannot choose an exact antipode's route. Pick a stable plane.
    const axis =
      Math.abs(from.x) < Math.abs(from.z)
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 0, 1);
    tangent.crossVectors(from, axis).normalize();
    angle = Math.PI;
  } else tangent.divideScalar(length);
  const axis = new Vector3().crossVectors(from, tangent).normalize();
  const rotation = new Quaternion().setFromAxisAngle(axis, angle * t);
  return {
    direction: from.clone().applyQuaternion(rotation).normalize(),
    rotation,
    endRotation: new Quaternion().setFromAxisAngle(axis, angle),
  };
}

function geographicNorth(up: Vector3, longitude: number): Vector3 {
  return new Vector3()
    .crossVectors(up, new Vector3(Math.cos(longitude), 0, -Math.sin(longitude)))
    .normalize();
}

/** Upstream Rig.js's continuous camera basis, in Globe.gl's Y-up coordinates. */
function cameraBasis(
  up: Vector3,
  longitude: number,
  pitch: number,
  azimuth: number,
  roll: number,
  northHint?: Vector3,
): { quaternion: Quaternion; backward: Vector3 } {
  const north = northHint ?? geographicNorth(up, longitude);
  const east = new Vector3().crossVectors(north, up).normalize();
  const horizontal = east
    .multiplyScalar(Math.sin(azimuth))
    .addScaledVector(north, Math.cos(azimuth));
  const backward = horizontal
    .clone()
    .multiplyScalar(Math.cos(pitch))
    .addScaledVector(up, Math.sin(pitch));
  const vertical = horizontal
    .clone()
    .multiplyScalar(-Math.sin(pitch))
    .addScaledVector(up, Math.cos(pitch));
  const right = new Vector3().crossVectors(vertical, backward).normalize();
  vertical.crossVectors(backward, right).normalize();
  if (roll) {
    const oldRight = right.clone();
    right
      .multiplyScalar(Math.cos(roll))
      .addScaledVector(vertical, Math.sin(roll));
    vertical
      .multiplyScalar(Math.cos(roll))
      .addScaledVector(oldRight, -Math.sin(roll));
  }
  return {
    quaternion: new Quaternion()
      .setFromRotationMatrix(new Matrix4().makeBasis(right, vertical, backward))
      .normalize(),
    backward,
  };
}

/** Pure, seekable flight. The first pose is exact, including a retargeted bank
 * or lens; the last is a north-up, center-looking OrbitControls pose at 50°. */
export function sampleFlight(
  from: CameraPose,
  to: GlobePov,
  t: number,
  kind: FlightKind,
  radius: number,
): FlightPose {
  if (!(radius > 0) || !Number.isFinite(radius))
    throw new RangeError("Invalid globe radius");
  if (
    ![
      to.lat,
      to.lng,
      to.altitude,
      t,
      from.fov,
      from.position.x,
      from.position.y,
      from.position.z,
      from.quaternion.x,
      from.quaternion.y,
      from.quaternion.z,
      from.quaternion.w,
    ].every(Number.isFinite)
  )
    throw new RangeError("Invalid camera pose");
  const startPosition = new Vector3().copy(from.position);
  const startRadius = startPosition.length();
  if (!(startRadius > radius) || !(to.altitude > 0) || Math.abs(to.lat) > 90)
    throw new RangeError("Camera endpoints must be above the globe");
  const progress = clamp01(t);
  const startQuaternion = new Quaternion().copy(from.quaternion);
  const startAltitude = startRadius / radius - 1;
  if (progress === 0)
    return {
      position: startPosition,
      quaternion: startQuaternion,
      up: worldUp.clone(),
      fov: from.fov,
      progress,
      altitude: startAltitude,
      pitch: Math.PI / 2,
      roll: 0,
    };
  const startDirection = startPosition.clone().divideScalar(startRadius);
  const destination = surfaceDirection(to.lat, to.lng);
  const ease = smootherstep(progress);
  const arc = greatCircle(startDirection, destination, ease);
  const direction = progress === 1 ? destination : arc.direction;
  const startLongitude = Math.atan2(startDirection.x, startDirection.z);
  // At a pole, the endpoint's longitude still identifies a stable meridian.
  const longitude =
    progress === 1 ? to.lng * radians : Math.atan2(direction.x, direction.z);
  // Geographic north flips when a route crosses a pole. Transport the starting
  // tangent frame along the arc, then release its meridian difference smoothly
  // across the flight. This keeps the camera continuous and lands north-up.
  const startNorth = geographicNorth(startDirection, startLongitude);
  const endNorth = geographicNorth(destination, to.lng * radians);
  const transportedEnd = startNorth.clone().applyQuaternion(arc.endRotation);
  const meridianTurn = Math.atan2(
    destination.dot(new Vector3().crossVectors(transportedEnd, endNorth)),
    Math.max(-1, Math.min(1, transportedEnd.dot(endNorth))),
  );
  const frameNorth =
    progress === 1
      ? endNorth
      : startNorth
          .clone()
          .applyQuaternion(arc.rotation)
          .applyAxisAngle(direction, meridianTurn * ease);
  const shot = kind === "dive" ? SHOTS.dive : SHOTS.descent;
  const channelTime = kind === "return" ? 1 - ease : ease;
  const distanceProgress =
    kind === "zoom"
      ? cinematic(ease)
      : kind === "return"
        ? 1 - shot.distance(channelTime)
        : shot.distance(channelTime);
  const altitude =
    progress === 1
      ? to.altitude
      : mixLog(startAltitude, to.altitude, distanceProgress);
  const envelope = Math.sin(Math.PI * progress) ** 2;
  const intensity = kind === "zoom" ? 0 : kind === "dive" ? 0.22 : 0.16;
  const pitch =
    Math.PI / 2 -
    (90 - shot.pitch(channelTime)) * radians * intensity * envelope;
  const azimuth =
    Math.PI +
    shot.sweep * radians * 0.04 * shot.azimuth(channelTime) * envelope;
  const roll =
    shot.roll(channelTime) *
    radians *
    0.45 *
    envelope *
    (kind === "zoom" ? 0 : 1);
  const basis = cameraBasis(
    direction,
    longitude,
    pitch,
    azimuth,
    roll,
    frameNorth,
  );
  const eyeRadius = radius * (1 + altitude);
  // Solve |R*up + distance*backward| = eyeRadius. The rationalized form stays
  // accurate near the surface and keeps every oblique frame above the sphere.
  const root = Math.sqrt(eyeRadius ** 2 - (radius * Math.cos(pitch)) ** 2);
  const distance =
    (eyeRadius ** 2 - radius ** 2) / (root + radius * Math.sin(pitch));
  const position = direction
    .clone()
    .multiplyScalar(radius)
    .addScaledVector(basis.backward, distance);
  if (progress === 1) position.copy(destination).multiplyScalar(eyeRadius);
  const initialBasis = cameraBasis(
    startDirection,
    startLongitude,
    Math.PI / 2,
    Math.PI,
    0,
  );
  const residual = startQuaternion
    .clone()
    .multiply(initialBasis.quaternion.invert())
    .normalize();
  residual.slerp(identity, smootherstep(clamp01(progress / 0.4)));
  const quaternion = residual.multiply(basis.quaternion).normalize();
  const lens =
    BASE_FOV +
    (shot.fov(channelTime) - BASE_FOV) *
      0.22 *
      envelope *
      (kind === "zoom" ? 0 : 1);
  const fov =
    progress === 1
      ? BASE_FOV
      : lens +
        (from.fov - BASE_FOV) * (1 - smootherstep(clamp01(progress / 0.4)));
  return {
    position,
    quaternion,
    up: worldUp.clone(),
    fov,
    progress,
    altitude,
    pitch,
    roll,
  };
}

interface RunningFlight extends FlightOptions {
  from: CameraPose;
  to: GlobePov;
  elapsed: number;
}
// A structural bridge keeps the pure sampler importable by the Node test build.
const frameClock = globalThis as typeof globalThis & {
  requestAnimationFrame(callback: (timestamp: number) => void): number;
  cancelAnimationFrame(id: number): void;
};

export class CinematicCamera {
  private flight?: RunningFlight;
  private frame?: number;
  private lastTime = 0;
  private enabled = true;
  private disposed = false;
  private generation = 0;
  private lastKind: FlightKind | null = null;
  private lastProgress = 0;
  private lastPitch = Math.PI / 2;
  private lastRoll = 0;
  private lastDuration = 0;

  constructor(
    private camera: PerspectiveCamera,
    private radius: number,
    private onFrame: () => void,
    private reducedMotion: boolean,
  ) {}

  get active(): boolean {
    return this.flight !== undefined;
  }
  get snapshot() {
    return {
      active: this.active,
      kind: this.lastKind,
      progress: this.lastProgress,
      paused: !this.enabled,
      altitude: this.camera.position.length() / this.radius - 1,
      fov: this.camera.fov,
      pitch: this.lastPitch,
      roll: this.lastRoll,
      durationMs: this.lastDuration,
    };
  }

  flyTo(to: GlobePov, options: FlightOptions): void {
    if (this.disposed) return;
    const from: CameraPose = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      fov: this.camera.fov,
    };
    const durationMs = this.reducedMotion ? 0 : Math.max(0, options.durationMs);
    if (!Number.isFinite(durationMs))
      throw new RangeError("Invalid flight duration");
    const first = sampleFlight(
      from,
      to,
      durationMs ? 0 : 1,
      options.kind,
      this.radius,
    );
    // Retarget directly from the displayed pose. cancel() would deliberately
    // rebase for user controls, introducing a jump between two authored flights.
    this.stopFrame();
    const generation = ++this.generation;
    const flight: RunningFlight = {
      ...options,
      durationMs,
      from,
      to: { ...to },
      elapsed: 0,
    };
    this.flight = durationMs ? flight : undefined;
    this.lastKind = options.kind;
    this.lastDuration = durationMs;
    this.apply(first);
    if (generation !== this.generation || this.disposed) return;
    if (!durationMs) options.onComplete?.();
    else if (this.enabled) {
      this.lastTime = performance.now();
      this.schedule();
    }
  }

  cancel(): void {
    if (!this.flight) return;
    ++this.generation;
    this.flight = undefined;
    this.stopFrame();
    const position = this.camera.position;
    const to: GlobePov = {
      lat: Math.atan2(position.y, Math.hypot(position.x, position.z)) / radians,
      lng: Math.atan2(position.x, position.z) / radians,
      altitude: position.length() / this.radius - 1,
    };
    // OrbitControls cannot preserve a surface-target gaze or bank. Cancellation
    // therefore rebases orientation/lens immediately while retaining position;
    // restrained authored tilt and roll limit this unavoidable handoff change.
    const progress = this.lastProgress;
    this.apply(
      sampleFlight(
        { position, quaternion: this.camera.quaternion, fov: this.camera.fov },
        to,
        1,
        "zoom",
        this.radius,
      ),
    );
    this.lastProgress = progress;
  }

  setActive(active: boolean): void {
    if (this.disposed || this.enabled === active) return;
    this.enabled = active;
    this.stopFrame();
    if (active && this.flight) {
      this.lastTime = performance.now();
      this.schedule();
    }
  }

  destroy(): void {
    ++this.generation;
    this.stopFrame();
    this.flight = undefined;
    this.enabled = false;
    this.disposed = true;
  }

  private apply(pose: FlightPose): void {
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
    this.camera.up.copy(pose.up);
    if (this.camera.fov !== pose.fov) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.lastProgress = pose.progress;
    this.lastPitch = pose.pitch;
    this.lastRoll = pose.roll;
    this.onFrame();
  }

  private stopFrame(): void {
    if (this.frame !== undefined) frameClock.cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }
  private schedule(): void {
    this.frame = frameClock.requestAnimationFrame(this.tick);
  }
  private tick = (timestamp: number): void => {
    this.frame = undefined;
    const flight = this.flight;
    if (this.disposed || !this.enabled || !flight) return;
    const generation = this.generation;
    flight.elapsed += Math.max(0, timestamp - this.lastTime);
    this.lastTime = timestamp;
    const progress = Math.min(1, flight.elapsed / flight.durationMs);
    if (progress === 1) this.flight = undefined;
    this.apply(
      sampleFlight(flight.from, flight.to, progress, flight.kind, this.radius),
    );
    if (generation !== this.generation || this.disposed) return;
    if (progress === 1) flight.onComplete?.();
    else if (this.enabled) this.schedule();
  };
}
